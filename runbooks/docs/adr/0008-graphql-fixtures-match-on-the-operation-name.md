# Mocked GraphQL fixtures match on the operation name

A fixture matched a request by method, path and query, so every GraphQL operation, sent as `POST /graphql`, got the same fixture. A mocked runbook could not serve a page its own data, and a data precondition such as "the client belongs to no group" could not be faked, because it arrives in a read on page load. A fixture now names the operation it answers in an optional `request.operationName`. The server reads `operationName` from the JSON request body, and a fixture that names an operation answers only that operation. A fixture without it answers any body, as before, so existing fixtures keep working. Matching stays on the request the transport sees plus this one name, because the name is the field that says what the page asks for, Apollo sends it for every named operation, and recording can write it without parsing the query. In a batch (a JSON array body), each item is answered by the fixture of its operation, and recording saves one fixture per operation, so a fixture still holds when Apollo groups the operations into other batches on the next run. A mocked GraphQL runbook still covers no endpoint (ADR 0004): it lists `POST /graphql` in `calls` or `covers.entries` and proves only what the screen shows and the request it sends.

## Considered Options

- Matching on any body field, with a path expression in the fixture. Rejected: the fixture format would need a small query language, while the operation name alone serves the pages that need it.
- Matching on GraphQL variables. Not built. Step and case folders already give one record per pass. A page that sends the same operation twice in one step with different variables needs it, and until then a recording keeps only the last result and logs the overwrite. This is the follow-up. Built in ADR 0009.
- Finding the operation by parsing the query document when the body has no `operationName`. Rejected: the server is one dependency-free file, and an anonymous operation is rare enough to stay on fixtures without `operationName`.
- Letting a fixture without `operationName` answer each item of a batch. Rejected: a batch recorded before this change is one fixture whose body is the whole array, and it would answer each item with that array.

## Consequences

- A batch is answered item by item only from fixtures that name an operation. An item without one makes the batch a 501 that lists the missing operations. A fixture with a status of 300 or more answers the whole batch, as a GraphQL server fails a whole HTTP request. A batch that failed while recording is not saved, because the failing operation cannot be told apart.
- Recorded files carry the operation in their name (`post--graphql-<operation>.json`).
- `runbooks.mjs fixtures` and `contract` do not check a fixture with `request.operationName` against `upstream.schema`, which is an OpenAPI document. Nothing checks GraphQL fixtures against a GraphQL schema yet, and a `POST /graphql` call is a `call` finding when the OpenAPI file lacks that path.
- The copied server changed, so `list` and `coverage` warn about a copy from an older version until `/runbooks:setup` refreshes it.
