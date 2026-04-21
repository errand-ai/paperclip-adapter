## ADDED Requirements

### Requirement: CI build and test on pull requests
The CI pipeline SHALL build and test the package on every pull request to `main`.

#### Scenario: PR triggers CI
- **WHEN** a pull request is opened or updated targeting `main`
- **THEN** the CI pipeline SHALL install dependencies, run linting, run tests, and build the package
- **THEN** the pipeline SHALL fail if any step fails

### Requirement: Publish to npmjs.com on version tags via OIDC
The CI pipeline SHALL publish the package to npmjs.com when a version tag is pushed, authenticating via OIDC trusted publishers.

#### Scenario: Tag triggers publish
- **WHEN** a git tag matching `v*` is pushed
- **THEN** the CI pipeline SHALL build the package and publish to npmjs.com using OIDC trusted publisher authentication
- **THEN** the publish step SHALL use `--provenance --access public` flags
- **THEN** the publish job SHALL have `id-token: write` permission for OIDC
- **THEN** the publish job SHALL use Node 24 (which ships with npm >= 11.5.1 required for trusted publishing)

### Requirement: Package configuration
The package SHALL be configured for public npm publishing with correct metadata.

#### Scenario: Package.json structure
- **WHEN** the package is published
- **THEN** `package.json` SHALL have `name: "@errand-ai/paperclip-adapter"`, `type: "module"`, and `publishConfig: { access: "public", registry: "https://registry.npmjs.org/" }`
- **THEN** `package.json` SHALL have `repository.url` matching the GitHub repo configured as a trusted publisher
- **THEN** the `exports` field SHALL map `"."` to the built entry point, `"./server"` to the server adapter module, and `"./ui-parser"` to the transcript parser
- **THEN** `@paperclipai/adapter-utils` SHALL be listed as a dependency
