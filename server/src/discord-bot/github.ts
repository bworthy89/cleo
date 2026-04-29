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
    const [owner, repoName] = opts.repo.split('/');
    if (!owner || !repoName) throw new Error(`bad repo slug: ${opts.repo}`);
    this.token = opts.token;
    this.owner = owner;
    this.repoName = repoName;
    this.retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  }

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        return await this.postIssue(input);
      } catch (err) {
        lastErr = err;
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
      req.write(payload);
      req.end();
    });
  }
}
