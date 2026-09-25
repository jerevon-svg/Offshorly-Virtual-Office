# FINAL-v2 teaser — required assets

The assets `final_master.py` needs to reproduce the definitive FINAL-v2 master **`out/teaser/virtual-office-video.mp4`** (63.87 s, 1920×1080, 30 fps).
Tracked here: the tooling only (`final_master.py`, `logo.mjs`, `capture.sh`, the rig in `../`). Everything below lives in the
git-ignored `frontend/scripts/film/out/`.

**The paid/generated audio is intentionally NOT committed.** It stays local; back it up outside git. Verify a restored copy
against the SHA-256 values below before rendering.

## 1. Audio — `out/teaser/audio/` (paid/generated, local only)

Provenance comes from this production's own session records: the files carry no embedded metadata (encoder tag only). The
music and sound effects were generated through the Magnific connector (music + sound-effect generation) and the narration
with its text-to-speech. These records don't map each effect file to an individual generation call, and they don't state a
licence. Usage rights are whatever the generating account's Magnific / ElevenLabs terms grant; nothing here asserts more.

| File | Role in FINAL-v2 | Bytes | SHA-256 | Origin |
|---|---|---:|---|---|
| `cave.mp3` | Cave reveal | 48,945 | `3f7f24f55da2c179068c80853657298c51dc934b9c352523985cd3fc6e617c67` | Magnific sound-effect generation |
| `click1.mp3` | Soft UI tick (kiosk, Search typing, Boards grab, birthday wish) | 17,180 | `04e2bcd9bd4eb717c970bf08e4838b4037df30b3d30e8ae1302722f4b77ac304` | Magnific sound-effect generation |
| `click2.mp3` | Soft UI tick (gates, Missions tab, Boards drop, Kudos) | 17,180 | `13ac6057d7fef19072d770abd1f47a410107d088cb43ffca8a7fa54fd0a855e1` | Magnific sound-effect generation |
| `confirm.mp3` | Check-in confirm; quest claim | 33,062 | `29688db47ea16aa0ed85b48118e07ea100684354ff6d6ceeb38623fb6f78bd4e` | Magnific sound-effect generation |
| `deny.mp3` | Gate refusal | 17,180 | `02592040f0be2a434d2c53907610a23f5874bc15d0c2c32d21214d2eeb7d2ec9` | Magnific sound-effect generation |
| `ding.mp3` | Elevator arrival ding (52.133) | 33,062 | `7120eebdf1ea300e39efbcfd657ffdd5bc0f6fb7d91f96af4b40e557a7745c9d` | Magnific sound-effect generation |
| `elevator.mp3` | Elevator hum bed | 97,010 | `907ff973b59af84d8dbde76b6e20eca96f615c6bee1a6ab6aac2477ad8ff8944` | Magnific sound-effect generation |
| `hit1.mp3` | Montage cut accent | 17,180 | `e707b20653d931a4c36132915dc718a59dce6964d643c42429cd2e434723a899` | Magnific sound-effect generation |
| `hit2.mp3` | Montage cut accent | 17,180 | `4611734a6cfa80d6024bcd6e9d0429e794e05554c98d096b60f4d0c8ff6bc83c` | Magnific sound-effect generation |
| `impact.mp3` | ALIVE impact | 48,945 | `ba2b2d17e9adba53d7770d541dd337aecfb03c09ba8524f897d662d0edd29a02` | Magnific sound-effect generation |
| `jump.mp3` | Jump/land (PlayerV2; staggered celebration jumps) | 33,062 | `23bd9fcf0e74bef93a7eed53d9edc5e6be6cf38683de7747e86f0e52f3db77b5` | Magnific sound-effect generation |
| `music.mp3` | Score — all five music segments (build, drive, warmth, door swell + decay, card resolution) | 1,680,813 | `c01d0ab9af1ba381f90a951510b67a2dca3135ac50ee0a87566c17ff86eeb31e` | Magnific music generation |
| `notif.mp3` | Message landing (Alex's DM) | 17,180 | `9bf574dee473c2d5f25c46867edf7580f470db688a9ab7f68216a18bc1c9b91d` | Magnific sound-effect generation |
| `office.mp3` | Office ambience bed (opening, 3D air, muffled→open EXPERIENCE bed, human section) | 193,141 | `69ea98fa6cdccfca45571878128352b0d46864ce2dcaef1f4269748736adfdaa` | Magnific sound-effect generation |
| `riser.mp3` | ALIVE riser | 33,062 | `9383e14f73a42afff68e74aa65f69f1d62e2a8fb9c6e86e1d2309269b97f1eb6` | Magnific sound-effect generation |
| `run.mp3` | Footsteps (walk, sprint, a coworker jogging) | 97,010 | `ce1a5613e52ba042fa382a88a5b198d485c9479c42c88363bcd3e87471ea1e6c` | Magnific sound-effect generation |
| `vo-final.mp3` | Narration — the one continuous Liam Hayes take, placed phrase by phrase | 637,431 | `e506c056041f4c1798f96be6becd30f76e5f8dca026445c761f1d4b7164e94e5` | Magnific text-to-speech, voice "Liam Hayes" (listed by Magnific as provider ElevenLabs) |
| `zzzp2.mp3` | Electrical tension build into the blackout + 0.4 s decay | 65,245 | `8f7805be1108ab0fd0b99c38e9be853e2552cbb4ad7df6ec79183ebce881f08a` | Magnific sound-effect generation |

Present in the folder but **not used** by FINAL-v2: `vo1.mp3`–`vo5.mp3` (earlier narration takes), `zzzp1.mp3`,
`audition/vo1-henry-fletcher.mp3`.

## 2. Picture — the High takes (captured on the film rig, local only)

Raw frames plus each take's `list.txt` (real on-screen timestamps). Captured at the locked standard (`capture.sh`: Custom
graphics, render scale 0.85, DPR 1, JPEG 95). They're live captures: recapturing gives new takes, not identical ones.

| Take | Location |
|---|---|
| `AliveV2` | `out/pass1/clips/AliveV2.frames/` |
| `CaveV2` | `out/pass2/clips/CaveV2.frames/` |
| `ElevatorV2` | `out/pass2/clips/ElevatorV2.frames/` |
| `FeatBoards` | `out/pass2/clips/FeatBoards.frames/` |
| `FeatSearch` | `out/pass2/clips/FeatSearch.frames/` |
| `FeatTasks` | `out/pass2/clips/FeatTasks.frames/` |
| `FeatToucan` | `out/pass2/clips/FeatToucan.frames/` |
| `HumCards` | `out/pass2/clips/HumCards.frames/` |
| `HumConvo` | `out/pass2/clips/HumConvo.frames/` |
| `HumGather` | `out/pass2/clips/HumGather.frames/` |
| `HumTasks` | `out/pass2/clips/HumTasks.frames/` |
| `HumTeam` | `out/pass2/clips/HumTeam.frames/` |
| `HumVideo` | `out/pass2/clips/HumVideo.frames/` |
| `PlayerV2` | `out/pass2/clips/PlayerV2.frames/` |
| `ReceptionV2` | `out/pass1/clips/ReceptionV2.frames/` |
| `TourV2` | `out/pass2/clips/TourV2.frames/` |

## 3. Generated by tooling (reproducible)

| File | Made by |
|---|---|
| `out/final/offshorly-logo-reversed.png` (18,054 bytes, SHA-256 `6f0070e582e16a59f60722ca6d5b6922eb99ae6dde4c97db8c13633cdad177d6`) | `node scripts/film/teaser/logo.mjs`. It reads the official `src/assets/brand/offshorly-logo.svg` and swaps only the `#1c1c22` wordmark fill to white in memory. The brand file is never written. |
| `out/teaser/final-master-subs.ass`, `final-master-filter.txt`, `segs-final-master/` | `final_master.py` (the intermediates are deleted after a verified render) |

## 4. Environment

- `FILM_FFMPEG`: an ffmpeg with libx264, libass and drawtext (e.g. `npm i ffmpeg-static` in any scratch folder). Required.
- macOS system fonts (`/System/Library/Fonts`, Helvetica Neue) for the captions.
- Google Chrome at `/Applications/Google Chrome.app` (the logo render; the capture rig).
- Recapture only: the film rig (`backend/run-film-backend.sh` on :8003, `backend/film-db.sh` snapshot/restore, the :5175
  film vite server), `out/bon-camera.mjpeg` (`make-camera.mjs`), `out/silence.wav`, `out/profiles/camera`.

## Render

```
export FILM_FFMPEG=/path/to/ffmpeg
python3 frontend/scripts/film/teaser/final_master.py   # → out/teaser/virtual-office-video.mp4
```
Expected anchors: ALIVE 9.80 · EXPERIENCE 16.60 · spatial video (H5) 34.833–36.367 · ding 52.133 · blackout 56.267 ·
card 59.457 · end 63.857.
