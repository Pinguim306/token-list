import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { graphql } from "ponder";

/**
 * GraphQL endpoint for the frontend.
 *
 * Ponder serves GraphQL by default, but declaring it explicitly pins the routes
 * the app depends on (`/` and `/graphql`) so an upgrade cannot silently move
 * them out from under `NEXT_PUBLIC_INDEXER_URL`.
 */
const app = new Hono();

app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
