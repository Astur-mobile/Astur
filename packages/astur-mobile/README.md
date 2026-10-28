<div align="center">

<a href="https://astur-mobile.github.io/Astur/">
  <img src="https://raw.githubusercontent.com/Astur-mobile/Astur/main/docs-site/public/brand/social@2x.png" alt="Astur: mobile apps, Playwright API. Open-source mobile test automation for Android and iOS, on native agents. No Appium server." width="100%">
</a>

<br>
<br>

[![npm version](https://img.shields.io/npm/v/astur-mobile?style=flat-square&label=npm&color=2BC4B4&labelColor=06101D)](https://www.npmjs.com/package/astur-mobile)
[![npm downloads](https://img.shields.io/npm/dm/astur-mobile?style=flat-square&label=downloads&color=C9A54E&labelColor=06101D)](https://www.npmjs.com/package/astur-mobile)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-9AA9C2?style=flat-square&labelColor=06101D)](https://github.com/Astur-mobile/Astur/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Astur-mobile/Astur?style=flat-square&color=C9A54E&labelColor=06101D)](https://github.com/Astur-mobile/Astur)

**[Website](https://astur-mobile.github.io/Astur/)** &nbsp;·&nbsp;
**[Get started](https://astur-mobile.github.io/Astur/getting-started/)** &nbsp;·&nbsp;
**[GitHub](https://github.com/Astur-mobile/Astur)**

</div>

# astur-mobile

The command-line tool of [Astur](https://github.com/Astur-mobile/Astur): Playwright-style test
automation for real Android and iOS apps, on native agents, with no Appium server.

```bash
npm install -D astur-mobile @astur-mobile/test @playwright/test
```

```bash
npx astur-mobile doctor        # check Android, iOS and agent prerequisites
npx astur-mobile devices       # list emulators, simulators and devices
npx astur-mobile init          # scaffold a config and a first test
npx astur-mobile codegen       # live inspector: mirror a device and record a spec (alias: inspect)
npx astur-mobile screenshot    # capture a device screen to a PNG
npx astur-mobile test          # run your specs on the Playwright Test runner
```

Starting from scratch? `npm create astur@latest` sets up a project for you.

Full documentation: **[astur-mobile.github.io/Astur](https://astur-mobile.github.io/Astur/)**.
If Astur is useful to you, a ⭐ on [GitHub](https://github.com/Astur-mobile/Astur) helps others find it.

## License

Apache-2.0 © Amr Salem. "Astur" is a trademark; see the [main repository](https://github.com/Astur-mobile/Astur).
