import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

const ThrottledOctokit = Octokit.plugin(throttling);

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

export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repoName: string;
  private readonly retryDelaysMs: number[];

  constructor(opts: GitHubClientOptions) {
    const [owner, repoName] = opts.repo.split('/');
    if (!owner || !repoName) throw new Error(`bad repo slug: ${opts.repo}`);
    this.owner = owner;
    this.repoName = repoName;
    this.retryDelaysMs = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
    this.octokit = new ThrottledOctokit({
      auth: opts.token,
      throttle: {
        onRateLimit: (retryAfter, options, _o, retryCount) => {
          if (retryCount < 1) return true;
          return false;
        },
        onSecondaryRateLimit: () => true,
      },
    });
  }

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        const res = await this.octokit.rest.issues.create({
          owner: this.owner,
          repo: this.repoName,
          title: input.title,
          body: input.body,
          labels: input.labels,
        });
        return { number: res.data.number, htmlUrl: res.data.html_url };
      } catch (err) {
        lastErr = err;
        if (attempt < this.retryDelaysMs.length) {
          await new Promise((r) => setTimeout(r, this.retryDelaysMs[attempt]));
        }
      }
    }
    throw lastErr;
  }
}
