# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds: the Wiki.js address and an API key, kept by Gladys
in the integration configuration (never logged, never written to `/data`).
`/data` holds a small JSON file with the Wiki.js address, the time and ids of
the newest page change already seen by the scene triggers, and the changes
written by the integration itself. The container only talks to the Wiki.js
address (`/graphql`), over HTTP or HTTPS. With the key it reads the pages the
key may see, the version of Wiki.js when the key may read it, and it writes
only what a scene action asks for: a new page, or a line added at the end of a
page. It never deletes nor moves anything.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Wiki.js itself (see the
[Wiki.js security policy](https://github.com/requarks/wiki/security/policy)).
