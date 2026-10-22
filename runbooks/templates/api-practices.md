### API scripts

How this project's `api` runbook scripts are written. `to-test` follows it; `setup` rewrites it.

- Library and command: <tests.api.framework>, run with `<tests.api.command>`.
- Naming: one test per runbook step, its name starting with the step id (`<an example in this framework's style>`). Tests without a step prefix belong to the project, not to a runbook.
- Isolation: <how each test starts from a clean state: RefreshDatabase, a transaction per test, a fresh in-memory app ...>.
- Data: <factories, seeders or builders the tests use, with their paths>.
- Auth: <the helper that acts as a role (actingAs, a token helper, a login request), with its path>.
- Requests: <how tests call the app: the framework's HTTP test client, supertest on the app instance ...>.
- Assertions: status first, then the body fields the step names, then effects through a read-back call; side effects with no endpoint through <the fakes this project uses: Mail::fake(), Queue::fake(), a mocked HTTP client ...>.
<Only with role tracking (roles.enabled); leave the next bullet out when tracking is off:>
- Roles: one test per step and role, its name ending with ` as <role>` (`<an example in this framework's style>`). Each test acts as that role through the auth helper above, and `anonymous` sends no credentials. A role line is asserted as it states it: the status and body, 403 for a signed-in role and 401 for `anonymous`. A role's test is not written for a step whose parent ended `denied`, `hidden` or `read-only` for that role, or is `not-applicable` for it.
<Only with role tracking and a runbook with cases; leave the next bullet out otherwise:>
- Cases: one test per step, role and case, its name ending with ` as <role> in <case>` (`<an example in this framework's style>`). A role that runs once has no ` in <case>` part and builds the first case of the runbook's `cases`. Each test builds the record of its case with the factory its Preconditions line names (`<this project's factory call for one case, such as Client::factory()->vip()->withTeam($user)>`), then acts as the role.
- External services: never called for real; <how this project stubs them>.
- The runbook is the source of truth: change the script to match its Expected, never the other way round without asking.
