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

## License

MIT © yuki-kisaku. See [LICENSE](LICENSE).
