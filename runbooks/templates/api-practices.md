### API scripts

How this project's `api` runbook scripts are written. `to-test` follows it; `setup` rewrites it.

- Library and command: <tests.api.framework>, run with `<tests.api.command>`.
- Naming: one test per runbook step and role, its name starting with the step id and ending with `as <role>` (`<an example in this framework's style>`). Tests without a step prefix belong to the project, not to a runbook.
- Isolation: <how each test starts from a clean state: RefreshDatabase, a transaction per test, a fresh in-memory app ...>.
- Data: <factories, seeders or builders the tests use, with their paths>.
- Auth: <the helper that acts as a role (actingAs, a token helper, a login request), with its path>. Each test calls it with the role its name ends with, and `anonymous` sends no credentials. A role's test is not written for a step whose parent ended `denied` for that role.
- Requests: <how tests call the app: the framework's HTTP test client, supertest on the app instance ...>.
- Assertions: for a role line, the status and body it states (403 for a signed-in role, 401 for anonymous); otherwise status first, then the body fields the step names, then effects through a read-back call; side effects with no endpoint through <the fakes this project uses: Mail::fake(), Queue::fake(), a mocked HTTP client ...>.
- External services: never called for real; <how this project stubs them>.
- The runbook is the source of truth: change the script to match its Expected, never the other way round without asking.
