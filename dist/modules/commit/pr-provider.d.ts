interface CreatePullRequestInput {
    cwd: string;
    head: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
}
interface PrProvider {
    name: string;
    createPullRequest(input: CreatePullRequestInput): Promise<{
        url: string;
    }>;
}
declare function detectProvider(originUrl: string): "github" | undefined;

export { type CreatePullRequestInput, type PrProvider, detectProvider };
