IBM Bob adds IBM Bob Shell as an agent provider in Paseo. Paseo starts `bob acp`, Bob's Agent Client Protocol server, and Bob reports its own modes and models.

## Setup

Install Bob Shell on the daemon machine so `bob` is on the daemon's `PATH`. Bob Shell needs Node.js 24 or later. Bob signs in with its own IBMid login by default.

To use an API key instead, open the plugin's settings and save `BOBSHELL_API_KEY`. The daemon keeps it in the macOS login Keychain and adds it to the environment of new and reopened Bob agents. The key is never sent back to the app. A `BOBSHELL_API_KEY` set in the provider's `env` in `config.json` or in the daemon's own environment takes precedence. Keychain storage needs a macOS daemon; on other systems, set the key in the provider's `env`.

## Usage

With an API key, Paseo's Usage panel shows each Bob team budget: Bobcoins used against the monthly limit, the remaining balance and the reset date. The plugin reads this from `GET https://api.us-east.bob.ibm.com/admin/v1/profile` with the API key. Only the us-east endpoint is used.

## Context window

Bob Shell does not report context usage over ACP. The plugin reads it from Bob's own task database, `~/.bob/db/bob.db`, read-only, when a session opens and after each turn. The maximum is the window Bob resolved for the task; an older premium task without one shows an estimate of 200,000 tokens. The database is Bob's internal format, so a Bob update can change it; the context window is then empty and the agent keeps working.

## Terminal

The plugin adds an IBM Bob terminal profile, `bob chat -- {{{prompt}}}`, the first time it starts. It never adds it again, so a profile you edit or delete stays that way. A Bob profile an earlier version added, and that you have not edited, is updated to this command.

The Terminal tab of the plugin settings has a "Bob terminal hooks" switch, off by default. Turned on, it adds hooks to `~/.bob/settings/settings.json` so Bob running in a Paseo terminal shows running, needs-input and finished status like Claude Code and Codex: a prompt marks it running, a permission request or a question from Bob marks it as needing input, and the end of a turn marks it finished. The hooks call Paseo's own `paseo hooks` command and do nothing outside a Paseo terminal. Turning the switch off removes only these hooks; other Bob hooks are left as they are. Turn it off before you remove the plugin: Paseo does not tell a plugin it is being removed, so the hooks would stay. To remove them by hand, delete the hook entries whose command ends with `# paseo-ibm-bob-hook`. The hooks need a POSIX shell, so they do not work on Windows.

## Limits

Paseo 0.17 or later shows Bob's installed version and an install link in the provider settings. Paseo 0.16 runs the agent and usage without that section.
