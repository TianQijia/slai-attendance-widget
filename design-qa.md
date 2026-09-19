# Desktop design QA · 1.3.0

final result: passed

## Evidence and normalization

- Source visual truth: `docs/design-target.png` (1337×1177), the selected light/dark centered-dial mock. The written confirmed plan and later calendar-dot feedback take precedence over mock details.
- Rendered evidence: `docs/demo.png` and `docs/demo-dark.png` (784×1876 pixels), captured from the actual desktop HTML with fictional September 19 data, 03:20:00, two intervals, calendar mode, phone settings collapsed.
- CSS viewport: 392×590, deviceScaleFactor 2. Full-page content is 392×938 CSS pixels. The real popup requests 410×620 outer dimensions; content scrolls vertically.
- The source board contains two framed panels, approximately 620×1142 pixels each, not an exact browser viewport. Compare each panel's content at 392-pixel width (about 0.63×); render evidence at 0.5× to normalize Retina density. Disregard the mock's surrounding canvas, shadows and frame. The extra collapsed controls and more spacious height are intentional confirmed requirements, not a pixel-exact clone of the image board.
- Full-view comparison: source and both rendered screenshots were opened in the same comparison input. The in-app browser at `http://127.0.0.1:4173/` was refreshed and inspected after the final dot change.
- Focused comparison: at the supplied high-density image scale the header/logo, timer, calendar selected date and dots, and bottom timeline are readable directly. Those regions were inspected in the same comparison; separate crops were unnecessary.

## Findings and comparison history

1. **P2, resolved — missing calendar status marks.** The first implementation followed the mock's bare dates but omitted the user's requested attainment marks. Added semantic green/yellow dots and explicit accessible labels. Subsequent request included qualified holidays: all known dates reaching six hours are green; only short workdays are yellow. Future and missing dates remain unmarked.
2. **P2, resolved — dots too small and insufficiently distinct.** User inspection of the first 4px marks found them hard to see. Increased diameter to 7px and row spacing to 10px. Light green `#14833b` / gold `#c08200` and dark green `#63dc91` / yellow `#ffcb45` are now visibly distinct in the post-fix evidence. Contrast against the surface is respectively 4.61:1 / 3.11:1 and 10.38:1 / 11.83:1. Labels provide the same state without relying on color alone.
3. **Additional verification — dark selected date.** A scaled image preview made “19” appear unclear, so the final image itself was checked: the selected-date text is present in dark foreground on pink (204 exact foreground pixels in the central text region). Both themes assert the selected text color, and theme changes are allowed to paint before capture. This was a capture-verification concern, not an established missing-text UI bug.

No actionable P0/P1/P2 visual findings remain in the reviewed desktop scope.

## Required fidelity surfaces

- **Fonts/typography:** system UI with Chinese and macOS fallbacks; 21px heading, bold tabular 32px timer, 19px month and 14px dates. The mock's hierarchy is retained. Date/controls do not collide or truncate at 320, 360, 392, 410 or 640px; font rasterization can vary by OS.
- **Spacing/layout:** centered 174px ring, 22px side padding, separated sections, one outer scroll. No nested month scroll. Calendar/list, date dialog, collapsed monthly details and phone settings are real controls. Bottom timeline stays last, as requested.
- **Colors/tokens:** timer, dial and attendance segments share `#d86b9f`. Light `#faf9fb` and dark `#19161c` surfaces follow OS theme. Large timer contrast is 3.07:1 on light; selected-day foreground is dark for readability. Status labels stay neutral, intentionally differing from the mock's small pink text. Selected mode uses an outline rather than low-contrast white-on-pink copy.
- **Image/asset quality:** real official emblem PNG, aspect ratio preserved, transparent padding, 16–256px sizes. No redrawn logo. Refresh/portal symbols are licensed Tabler SVG assets. Canvas dial/timeline and CSS calendar marks are data visualizations, not substituted image assets. Header looks sharp at 2×.
- **Copy/content:** current day explicitly means attendance day; rule details explain 05:00 and provisional estimates. Portal button names its actual action rather than the mock's unused settings icon. Phone folding explicitly preserves connection. Green includes qualified holidays; yellow only means a short workday. Historical qualification totals still count school-provided historical workdays only.

## Interactions and safety checked

- Default calendar, saved calendar/list selection, month lengths and rollover; missing/future placeholders.
- Day detail opens, Escape closes, arrow/Home/End navigation and native Enter activation; visible focus, labeled icons and meaningful canvas text.
- Phone settings start collapsed, expand/collapse without disconnecting or re-pairing; an error updates the collapsed heading.
- Exact segment totals equal the timer/ring; reduced-motion mode; 7px dot colors/sizes tested in both themes.
- Browser page-error collection is empty in desktop tests. Shared mobile calculations and legacy mobile layout are covered by the repository suite.
- Synthetic preview only: no school credentials, real records, telemetry or companion writes.

## Open questions and residual platform checks

- Mobile visual redesign is explicitly deferred; this QA does not claim a redesigned or physically retested phone UI.
- Official icon files, manifest declarations and window favicons are included; native Windows taskbar cache/grouping and macOS Dock ownership depend on Chrome/OS. macOS Dock can remain Chrome, as documented; no native wrapper was requested. Headless package checks do not establish native taskbar appearance.
- Current font fallback on a physical Mac and OS-level icon caches remain manual platform checks, not simulated evidence.

## Implementation checklist

- [x] Official logo and licensed icons; responsive layout and system themes.
- [x] Pink dial/timer/timeline; shared calculation result.
- [x] Clear attainment dots, including qualified holidays; no false failures for missing data.
- [x] Calendar/list persistence, date detail, keyboard controls, collapsed connection.
- [x] Browser inspection, re-capture and comparison after visual fixes.
- [x] README screenshots, rules, migration and platform limits updated.

## Follow-up polish

- P3: consider a future mobile-specific visual pass; keep it separate from this desktop release.
