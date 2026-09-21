# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [1.17.2](https://github.com/eltobiando/joplin-plugin-on-deck/compare/v1.17.1...v1.17.2) (2026-09-21)

### Bug Fixes

- ignore windowClosing messages from replaced windows ([54e7667](https://github.com/eltobiando/joplin-plugin-on-deck/commit/54e7667cfb6cdc67199c7f0c3b85085edb4ec11d))

## [1.17.1](https://github.com/eltobiando/joplin-plugin-on-deck/compare/v1.17.0...v1.17.1) (2026-09-19)

### Bug Fixes

- remove early-stop pagination that skipped due todos on mobile ([a47d2c3](https://github.com/eltobiando/joplin-plugin-on-deck/commit/a47d2c31ba3108f3e2b3d74df7b2cc0beb7b62f1))

## [1.17.0](https://github.com/eltobiando/joplin-plugin-on-deck/compare/v1.16.0...v1.17.0) (2026-09-18)

### Features

- show the target time each snooze preset lands on ([a808d1d](https://github.com/eltobiando/joplin-plugin-on-deck/commit/a808d1dde98e2787371cfb43343c2700a5c06ae4))

## [1.16.0](https://github.com/eltobiando/joplin-plugin-on-deck/compare/v1.15.1...v1.16.0) (2026-09-18)

### Features

- performance improvement - only search dated todos and stop pagination at the deadline ([a8aa5ed](https://github.com/eltobiando/joplin-plugin-on-deck/commit/a8aa5edc81bda337243ccd281e44b01db904514c))

## [1.15.1](https://github.com/eltobiando/joplin-plugin-on-deck/compare/v1.15.0...v1.15.1) (2026-09-14)

### Bug Fixes

- restore default window size regressed in c541e3b ([5f0a040](https://github.com/eltobiando/joplin-plugin-on-deck/commit/5f0a040be4c529b86a19f7ef2dc7ae7858d78f4a))

## 1.15.0 (2026-09-13)

### Features

- branch consolidation ([c4ffe46](https://github.com/eltobiando/joplin-plugin-on-deck/commit/c4ffe464d579aa8dac1cf7509e83eb80cbe84fc2))

## [1.14.0](https://github.com/eltobiando/joplin-plugin-on-deck/compare/v1.13.0...v1.14.0) (2026-09-13)

### Features

- add plugin icon and screenshots ([a688858](https://github.com/eltobiando/joplin-plugin-on-deck/commit/a688858d1e3a24f91502b3fe5d5c046d63792420))
- default the privacy overlay setting to off ([706170b](https://github.com/eltobiando/joplin-plugin-on-deck/commit/706170b741e8b44c1c3ed9f98b9730868c017bea))

### Bug Fixes

- add missing refresh button loading animation on mobile ([8d4b79f](https://github.com/eltobiando/joplin-plugin-on-deck/commit/8d4b79f01b3ffbb07731513218f4a3f0c5a010a8))
- address code review findings (5 bug fixes, cleanup, regression tests) ([c541e3b](https://github.com/eltobiando/joplin-plugin-on-deck/commit/c541e3bf912912a88c0b2fbb822dcf3b2fdec63b))

## [1.13.0](///compare/v1.12.1...v1.13.0) (2026-09-12)

### Features

- remove mark done functionality 1111425

## 1.12.1 (2026-09-12)

### Features

- add "Tomorrow at X" snooze preset with configurable hour 72f5824
- add 3hr, 3day, and 7day snooze presets with compacted dropdown UI 384e34b
- add auto-focus setting to bring window to foreground on new tasks b6029dc
- add confirmation dialog to bulk snooze button 9fbb19e
- add loading animation and F5 hotkey to the refresh button 723923c
- add look-ahead days setting to show upcoming due tasks 0786fe8
- add mobile support 8082e10
- add privacy overlay for auto-opened window 15aaba6
- add privacy overlay setting to make it optional 5c56166
- add toggleable look-ahead feature with UI button d2e0b81
- further mobile layout improvements c5a68d3
- further optimize performance. Introduce settings cache cb44aea
- further performance optimizations 9866b6f
- improve mobile layout f64ac8e
- improve mobile layout 7a9e1f5
- persist window position across restarts d6b876b
- preserve original due time for day-based snooze presets ceef451
- re-open the on-deck window when it is already open f873fba
- remember last used custom snooze days for the session f8b8c25
- replace 5 minute snooze preset with a 3 day one 2fc5767
- show absolute due date & time using Joplin's date format settings 3703c8b
- show snooze dropdown for snooze all button 806a0ff
- slight adjustment of default size 7716a85
- small performance improvement by skipping callback f6c549f
- split snooze time into hour and minute settings with live refresh 0b0f8bb

### Bug Fixes

- adjust default window size for Windows frame 119d870
- custom snooze days should add from current date, not original due date bfd320f
- filter out completed tasks from due list fdc343c
- fix snooze action and simplify window script loading 8297735
- handle window closed via X button 8847ef7
- lookahead button label 08ecb81
- make standalone window actually load scripts and display tasks d974f5e
- move scripts to end of body and add refresh button 4e3ce5e
- prevent footer/header from squashing on long task lists ebbd582
- prevent multiple windows after system resume 1b0aa39
- properly cleanup messageListener from window 0fcd4a9
- reorder custom snooze dropdown to days first a31f824
- save window position on close and guard against zero dimensions 391d6bb
- use correct openNote command and guard closed windows 10a8360
- use CSS :hover for snooze dropdown instead of inline JS handlers 6baf680
- use search + fetch-by-ID to work around Joplin API stripping todo_due 69132ed
- various smaller issue 6abfcbf
