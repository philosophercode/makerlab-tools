# Security policy

## Reporting a vulnerability

Please report security problems **privately**, through GitHub's
[private vulnerability reporting](https://github.com/philosophercode/makerlab-tools/security/advisories/new)
(the repository's **Security** tab, then **Report a vulnerability**). Do not open a public
issue or pull request for it.

Include what you found, where (a URL, route or file), and the steps to reproduce it. You
should hear back within a week. Please give us a reasonable time to fix it before you
disclose it.

## Scope

- The code in this repository.
- The Cornell Tech MakerLAB deployment at <https://www.makerlabai.app>. Test against your
  own copy where you can ([`docs/fork.md`](../docs/fork.md) runs one locally with no keys).
  Do not run load tests, spam the assistant (every chat turn is a paid model call), or
  read or change other people's data.

A deployment someone else runs from a fork is theirs; report its problems to its owner,
and here too if the cause is in this code.

## Supported versions

Only the latest commit on `main` is supported. There are no release branches.
