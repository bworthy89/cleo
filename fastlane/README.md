fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios snapshot_capture

```sh
[bundle exec] fastlane ios snapshot_capture
```

Capture App Store screenshots via XCUITest. Requires the ONAYUITests target to exist (see fastlane/SETUP.md) and Metro to be running with EXPO_PUBLIC_UITEST_MODE=true on each simulator's host network.

### ios frame

```sh
[bundle exec] fastlane ios frame
```

Frame raw screenshots with device bezels and marketing text

### ios upload

```sh
[bundle exec] fastlane ios upload
```

Upload metadata and screenshots to App Store Connect

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
