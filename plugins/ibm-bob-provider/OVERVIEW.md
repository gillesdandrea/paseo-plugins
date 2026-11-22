IBM Bob adds IBM Bob Shell as an agent provider in Paseo. Paseo runs Bob through `bob acp`, Bob's Agent Client Protocol server. The composer offers Bob's Agent, Plan and Ask modes. Bob chooses the model itself, so the plugin lists one model, named IBM Bob.

## Where your data goes

Bob agents run on IBM Bob, IBM's hosted service. Bob Shell sends your prompts, the files and command output its tools read, and the conversation to IBM under your Bob account, as it does when you use Bob Shell directly. The plugin sends nothing else to IBM apart from the usage request described below.

## Setup

The plugin needs Paseo 0.16.2 or later on macOS or Linux. Install Bob Shell on the daemon machine so `bob` is on the daemon's `PATH`. Bob Shell needs Node.js 24 or later. By default, Bob signs in with its own IBMid login.

To use an API key instead, save `BOBSHELL_API_KEY` in the plugin's settings. The daemon stores it in the macOS login Keychain and adds it to the environment of new and reopened Bob agents. The key never goes back to the app. A `BOBSHELL_API_KEY` set in the provider's `env` in `config.json`, or in the daemon's own environment, takes precedence over the Keychain. On Linux, set the key in the provider's `env`, because the Keychain is macOS only.

## Usage

With an API key, the Usage panel shows each Bob team budget: Bobcoins used against the monthly limit, the remaining balance and the reset date. The plugin reads these from `GET https://api.us-east.bob.ibm.com/admin/v1/profile` with the API key. It calls only the us-east endpoint, so an account hosted in another region may get no usage data.

## Context window

Bob Shell does not report context usage over ACP. The plugin reads it, read-only, from Bob's task database at `~/.bob/db/bob.db` when an agent opens and after each turn. The maximum is the window Bob resolved for the task. An older premium task that has none shows an estimate of 200,000 tokens. The database is Bob's internal format: if a Bob update changes it, the context window stays empty and the agent keeps working.

## Terminal

The first time the plugin starts, it adds an IBM Bob terminal profile that runs `bob chat -- {{{prompt}}}`. It never adds the profile again, so your edits and deletions stay. A Bob profile that an earlier version added, and that you have not edited, is updated to this command.

The Terminal tab of the plugin settings has a "Bob terminal hooks" switch, off by default. When it is on, Bob in a Paseo terminal shows the same status as Claude Code and Codex: running after a prompt, needs input when Bob asks for permission or asks you a question, and finished at the end of a turn. The switch adds hooks to `~/.bob/settings/settings.json` that call Paseo's `paseo hooks` command, and the hooks do nothing outside a Paseo terminal. Turning the switch off removes only these hooks and leaves your other Bob hooks.

Turn the switch off before you remove the plugin, because Paseo does not tell a plugin that it is being removed. To remove the hooks by hand, delete the hook entries whose command ends with `# paseo-ibm-bob-hook`. The hooks need a POSIX shell, so they do not run on Windows.

## Paseo versions

On Paseo 0.17 or later, the provider settings also show Bob's installed version and a link to Bob's install page.
