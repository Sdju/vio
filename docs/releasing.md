# Publishing workspace packages

The repository uses pnpm workspaces (`pnpm-workspace.yaml`, `pnpm-lock.yaml`) and Vite+ for installation and tasks. **Only the registry publish operation uses npm**, because npm CLI handles the GitHub OIDC exchange and provenance. The root package is private.

## Workflow

`.github/workflows/publish.yml` runs manually on `main` with:

- `workspace`: a public package name from a real `packages/*/package.json`, initially `@zede/vio`.
- `dry_run`: `true` by default; set to `false` for an actual release.

The workflow installs locked dependencies, checks FEOD and formatting, builds all workspace packages, checks types, runs unit tests, tests real GTK widgets, and installs a tarball in an isolated consumer project. Only then does `scripts/release.mjs` select the requested workspace and pack it through pnpm and run `npm publish` on the resulting archive. The package `prepack` script rebuilds the selected package, so a clean checkout cannot publish missing or stale `dist` files.

Publishing uses a GitHub-hosted runner, `id-token: write`, and the GitHub environment `npm`. No `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or registry token secret is needed. npm 11.19.0 is pinned in CI; trusted publishing requires npm >=11.5.1. Public releases from this public repository receive npm provenance automatically.

## First publication and trust setup

**A successful dry run does not establish a trusted-publisher relationship.** The package must already exist on npm before a trusted publisher can be configured. An authenticated maintainer must bootstrap the first version manually (or through npm staged publishing); CI must never be given a long-lived write token for this bootstrap.

1. Authenticate locally as npm user `zede`, with account 2FA enabled.
2. Run the repository checks and publish the first `@zede/vio` version from `packages/vio` with `npm publish --access public`. This initial manual publication does not have GitHub Actions provenance. Use npm's staged publishing instead if you want to review the initial package before public release.
3. Open the package's npm Settings → Trusted publishing and add GitHub Actions with these exact fields:

   | Field                | Value                                    |
   | -------------------- | ---------------------------------------- |
   | Organization or user | `Sdju`                                   |
   | Repository           | `vio`                                    |
   | Workflow filename    | `publish.yml`                            |
   | Environment          | `npm`                                    |
   | Allowed action       | Enable direct publishing (`npm publish`) |

   With a supported npm CLI, the equivalent is:

   ```bash
   npm trust github @zede/vio --repo Sdju/vio --file publish.yml --env npm --allow-publish
   ```

4. Bump the package to the next version, update the lockfile with `vp install`, commit and push to `main`.
5. Run the publish workflow first with `dry_run=true`, then with `dry_run=false`. Complete the first successful OIDC publish within two days after creating the trust configuration; unvalidated configurations expire.
6. Verify the registry version, tarball, provenance, and a consumer installation. Then consider disabling traditional token-based publishing in npm package settings.

GitHub environment `npm` must allow `main`. The workflow and npm trusted-publisher environment names must match exactly. Restricting real publishing to `main` is also checked in the release script. PR workflows have no publishing permission.

## Independent package releases

Each additional package gets its own version, `publishConfig.access: "public"`, repository metadata (including `repository.directory`), and npm trusted publisher pointing to the same workflow. Supply its name as `workspace`; no workflow choice list is hardcoded. Publish workspace dependencies before their consumers. `pnpm pack` rewrites `workspace:` dependencies to registry semver ranges before npm publishes the archive. The root stays private and is never packed.

The release script rejects unknown/private workspaces and mismatched repository metadata. It never interpolates the workspace input into a shell command.

## References

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm trust CLI and prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
- [npm staged publishing](https://docs.npmjs.com/cli/v11/commands/npm-stage/)
