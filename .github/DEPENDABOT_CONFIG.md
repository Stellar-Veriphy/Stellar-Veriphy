# Dependabot Configuration

This document describes the automated dependency update process for Stellar-Veriphy.

## Overview

Dependabot automatically checks for outdated dependencies across all packages in this repository and creates pull requests to update them.

## Configuration Details

### Update Schedule

- **NPM packages (root):** Weekly on Monday at 03:00 UTC
- **NPM packages (frontend):** Weekly on Monday at 03:00 UTC
- **Cargo packages (contracts):** Weekly on Monday at 04:00 UTC
- **Docker base images:** Weekly on Tuesday at 03:00 UTC
- **GitHub Actions:** Weekly on Wednesday at 03:00 UTC

### Auto-Merge Policy

- **Minor and patch updates:** Automatically approved and merged
- **Major updates:** Require manual review before merging
- **Security updates:** Prioritized and can be merged immediately if tests pass

### Limits

- **Open pull requests limit:** 10 for NPM, 5 for Cargo and Docker
- This prevents overwhelming the repository with too many dependency updates at once

### Labels Applied

Each dependency update PR will be labeled with:

- `dependencies` - All dependency updates
- `maintenance` - Indicates this is maintenance work
- Environment-specific labels: `frontend`, `contracts`, `docker`, `github-actions`, `infrastructure`

## Monitoring and Troubleshooting

### Common Issues

1. **Failing Tests on Dependabot PR:**
   - Review the test output in the PR
   - If it's a breaking change, manual updates may be required
   - Comment on the PR to request changes or skip auto-merge

2. **Too Many PRs:**
   - Check the `open-pull-requests-limit` in `.github/dependabot.yml`
   - Increase the limit if PRs are being delayed excessively
   - Alternatively, adjust the schedule interval

3. **Blocked Auto-Merge:**
   - Major versions always require manual review
   - Check for required status checks or branch protections
   - Review security scan results if available

## Best Practices

1. **Review Security Updates First:** Always prioritize security updates
2. **Test Before Merging:** Ensure CI/CD checks pass on all PRs
3. **Update Lockfiles:** Ensure `package-lock.json` and `Cargo.lock` are updated
4. **Keep Branch Protected:** Maintain branch protection rules to ensure quality

## Manual Dependency Updates

For immediate updates (outside of schedule):

```bash
# NPM
pnpm update

# Cargo
cargo update

# Specific package
pnpm update package-name
cargo update -p crate_name
```

## Disabling Auto-Merge

If you need to temporarily disable auto-merge:

1. Modify the `if` condition in `.github/workflows/dependabot-auto-merge.yml`
2. Set `github.actor != 'dependabot[bot]'` to disable the workflow

## References

- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot)
- [GitHub Actions Dependabot Integration](https://docs.github.com/en/code-security/dependabot/working-with-dependabot)
