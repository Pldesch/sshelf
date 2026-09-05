# Estradeck upstream

This directory vendors [Syndicats/estradeck](https://github.com/Syndicats/estradeck)
at commit `02a1a3ea7369188752f66f548af7db15c418c947` under its MIT license.

Sshelf carries a small integration patch that:

- adds an explicit `embed=sshelf` mode and a validated `postMessage` channel;
- hides deck management and the raw Code/Styles tabs in embedded mode;
- reports deck, style, image, and video changes to the Sshelf sync bridge;
- makes presentation/theme directories and the bind host configurable; and
- supports Sshelf's `/estradeck` development proxy while keeping the iframe on
  an isolated loopback origin; and
- aligns the embedded client with Sshelf's React/Bun workspace.

Keep product-specific behavior behind `isSshelfEmbed()` where possible so an
upstream refresh remains reviewable.
