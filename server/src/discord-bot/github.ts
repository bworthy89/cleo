import * as https from 'https';

export interface GitHubClientOptions {
  token: string;
  repo: string; // "owner/repo"
  retryDelaysMs?: number[]; // default [1000, 4000, 16000]
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels: string[];
}

export interface CreateIssueResult {
  number: number;
  htmlUrl: string;
}

const DEFAULT_RETRY_DELAYS = [1_000, 4_000, 16_000];

interface GitHubError extends Error {
  status?: number;
}

export class GitHubClient {
  private readonly token: string;
  private readonly owner: string;
  private readonly repoName: string;
  private readonly retryDelaysMs: number[];

  constructor(opts: GitHubClientOptions) {
    const segments = opts.repo.split('/');
    if (segments.length !== 2 || !segments[0] || !segments[1]) {
      throw new Error(`bad repo slug: ${opts.repo}`);
    }
    this.token = opts.token;
    this.owner = segments[0];
    this.repoName = segments[1];
    this.retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  }

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        return await this.postIssue(input);
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number }).status;
        if (
          typeof status === 'number' &&
          status >= 400 &&
          status < 500 &&
          status !== 408 &&
          status !== 429
        ) {
          throw err; // permanent failure — don't retry
        }
        if (attempt < this.retryDelaysMs.length) {
          await new Promise((r) => setTimeout(r, this.retryDelaysMs[attempt]));
        }
      }
    }
    throw lastErr;
  }

  private postIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        title: input.title,
        body: input.body,
        labels: input.labels,
      });
      const req = https.request(
        {
          hostname: 'api.github.com',
          path: `/repos/${this.owner}/${this.repoName}/issues`,
          method: 'POST',
          timeout: 10_000,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Authorization: `token ${this.token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'cleo-discord-bot',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            try {
              const parsed = JSON.parse(data || '{}') as {
                number?: number;
                html_url?: string;
                message?: string;
              };
              if (status >= 200 && status < 300 && typeof parsed.number === 'number') {
                resolve({
                  number: parsed.number,
                  htmlUrl: parsed.html_url ?? '',
                });
              } else {
                const err: GitHubError = new Error(
                  `GitHub ${status}: ${parsed.message ?? 'request failed'}`
                );
                err.status = status;
                reject(err);
              }
            } catch (parseErr) {
              reject(parseErr);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('GitHub request timeout'));
      });
      req.write(payload);
      req.end();
    });
  }
}
