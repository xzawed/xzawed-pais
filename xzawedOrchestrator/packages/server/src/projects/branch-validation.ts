const VALID_BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/

export function validateBranchName(branch: string): void {
  if (!VALID_BRANCH_RE.test(branch)) {
    throw new Error(`Invalid branch name: ${branch}`)
  }
}
