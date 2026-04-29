import * as https from 'https';

export class Octokit {
  private token: string;

  static plugin(plugin: any) {
    return Octokit;
  }

  rest = {
    issues: {
      create: async (params: any) => {
        const { owner, repo, title, body, labels } = params;
        return new Promise((resolve, reject) => {
          const postData = JSON.stringify({ title, body, labels });
          const options = {
            hostname: 'api.github.com',
            path: `/repos/${owner}/${repo}/issues`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              Authorization: `token ${this.token}`,
              'User-Agent': 'octokit-mock',
            },
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                if (res.statusCode && res.statusCode >= 400) {
                  const error: any = new Error(
                    `GitHub API error: ${res.statusCode}`
                  );
                  error.status = res.statusCode;
                  error.response = { data: parsed };
                  reject(error);
                } else {
                  resolve({ data: parsed });
                }
              } catch (e) {
                reject(e);
              }
            });
          });

          req.on('error', reject);
          req.write(postData);
          req.end();
        });
      },
    },
  };

  constructor(opts: any) {
    this.token = opts.auth;
  }
}
