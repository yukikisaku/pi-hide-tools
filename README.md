# pi-hide-tools

## Overview

Hide tool rows by default and toggle a compact one-line view.

## Requirements

Requires Pi TUI APIs and patches tool-definition rendering in the current process. Tool execution and stored results are unchanged; only display is changed.

## Installation

```sh
pi install npm:@yukikisaku/pi-hide-tools
```

## Usage

Press Pi's `app.tools.expand` shortcut (Ctrl+O by default) to switch between hidden and compact tool-call rows. A widget shows the current mode.

## Configuration

No package-specific configuration. Change the shortcut through Pi keybindings.

## Uninstallation

```sh
pi uninstall npm:@yukikisaku/pi-hide-tools
```

Remove any package-specific configuration described above if you no longer need it.

## Pull requests

This repository includes a policy for automatic AI review and merge of incoming pull requests. It becomes active when the CI and merge workflows are on `main` and the maintainer's GitHub event automation is enabled; a draft setup PR does not activate it.

Once active, AI reviews each non-draft PR and it is merged automatically only when the review has no findings, required CI succeeds, and there are no conflicts or unresolved review threads. New commits require a new review. Changes to the automation itself require manual merge. See [AI review and merge operations](docs/ai-review-operations.md).

## License

MIT © yuki-kisaku. See [LICENSE](LICENSE).
