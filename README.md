# 🏈 Gridiron Blitz

A fast, chaotic **3-on-3 arcade American football** game that runs in the browser. It has toon-shaded, toy-like players, a floodlit "Friday night lights" stadium, big hits, fumbles that bounce all over the place, and slow-motion touchdown replays.

There's **no build step and nothing to install.** It's plain HTML, CSS and JavaScript ES modules. Three.js and PeerJS load from a CDN through an import map, so it runs on a school Chromebook and can be hosted as static files on GitHub Pages.

Everything is made in code at runtime: the 8 teams and their logos, the players, the stadium, the crowd and all the sounds. There are no model, image or audio files.

---

## Game modes

| Mode | What it is |
|---|---|
| **Quick Play** | You against the AI. Choose your team, the opponent and one of three difficulties (Rookie / Pro / All-Star). |
| **Local 2 Player** | Two players on one keyboard, one team each. AI fills the other spots on both teams. |
| **Online** | Up to 6 friends (3 per team) over the internet using PeerJS. Empty spots get AI players. |
| **Season** | A 7-game round-robin season against the other 7 teams. The top 4 make the playoffs, and the winner of the final takes the Blitz Bowl. Progress is saved in your browser. |
| **Team Editor** | Change any team's colors, helmet design and jersey style, and pick your jersey number. |

## Rules (arcade style)

- 3v3 on a 60-yard field with two 10-yard end zones.
- **4 downs to gain 20 yards** for a first down.
- 4 quarters of **2:00** each. The clock only runs during plays. **Overtime is sudden death.**
- A touchdown is **6 points**. Then you choose to go for **1 point** (from the 5-yard line) or **2 points** (from the 12-yard line).
- There's no kicking. After you score you can kick away, which gives the other team the ball at their own 15. Or you can try an **onside kick**: the ball bounces loose and whoever recovers it keeps it.
- Before every snap you have **5 seconds** to call a play. The offense picks one of 3 plays, shown as route diagrams. The defense picks **Blitz**, **Cover** or **Spy**.
- Big hits can cause **fumbles**. Tips and deflections stay live, and contested catches can go either way.

## Controls

### Offense
| Key | Action |
|---|---|
| `W A S D` | Move |
| `Shift` | Sprint (uses stamina) |
| `Space` | Pass to the highlighted receiver. **Tap** for a bullet, **hold** for a lob. A landing marker shows where the ball will come down. |
| `Q` / `E` | Cycle receivers |
| `J` | Juke |
| `K` | Spin |
| `L` | Stiff-arm |
| `Ctrl` or `C` | Dive |
| `1` `2` `3` | Call a play (you can also click the cards) |

### Defense
| Key | Action |
|---|---|
| `W A S D` / `Shift` | Move / sprint |
| `Tab` | Switch to the defender nearest the ball |
| `Space` | Tackle-dive |
| `J` | Jump to swat or intercept a pass |

### Player 2 (Local 2 Player)
Every action has a numpad key and a second key on the right side of the main keyboard, because most Chromebooks have no numpad.

| Action | Keys |
|---|---|
| Move / sprint | Arrow keys / `Right Shift` |
| Pass / tackle | `Numpad 0` or `/` |
| Juke / jump | `Numpad 1` or `.` |
| Spin | `Numpad 2` or `,` |
| Stiff-arm | `Numpad 3` or `M` |
| Dive | `Right Ctrl`, `Numpad .` or `'` |
| Switch defender | `Enter` |
| Cycle receivers | `Numpad 4 / 6` or `[` `]` |
| Call a play | `Numpad 7 8 9` |

`Esc` pauses the game. `Space` or `Enter` skips replays.

> Tip: if you're single-player, the arrow keys also work for moving.
> Chrome won't let a web page block `Ctrl+W`, so if you're worried about closing the tab by accident, dive with `C` instead.

## Playing with friends online

1. Everyone opens the game: your GitHub Pages URL, or any host that serves the files.
2. One person clicks **Online → Host Room**. They get a **4-letter room code** and a **shareable link** like `https://you.github.io/Football-Bros/?room=ABCD`.
3. Friends either open the link or go to **Online**, type the code and click **Join**.
4. In the lobby, each player picks a side, enters a name, presses **Ready**, and can send emoji reactions. The host chooses both teams and the AI difficulty, then presses **Start Game**.
5. Any empty spots are played by the AI. If someone disconnects mid-game, the AI takes over their player.

How it works: the game is **host-authoritative**. Clients send their inputs about 30 times a second. The host runs the only simulation and sends game state to everyone about 20 times a second. Each client predicts its own player's movement so controls feel instant, and smoothly interpolates everyone else.

Connections are peer-to-peer WebRTC, and PeerJS's free public server handles matchmaking. Some school or office networks block WebRTC. If you can't connect, try a different network or a phone hotspot.

<details>
<summary>Using your own PeerJS server (optional)</summary>

Add `?peerhost=your.host&peerport=443&peerpath=/&peersecure=1` to the URL. Invite links copy these settings automatically. You can run a server with `npx peer --port 9000`.
</details>

## Graphics quality

Change this in **Settings**. Medium is the default.

- **Low**: no post-processing and a smaller crowd. Best for older Chromebooks.
- **Medium**: bloom, FXAA, color grading and a vignette, plus instanced grass blades and a bigger crowd.
- **High**: everything in Medium, plus real-time shadows, the densest crowd and grass, full-resolution bloom, and a live camera feed on the jumbotron.

Every quality level gets toon shading with outlines, volumetric-style light cones, particles, speed trails, confetti, fireworks and TD replays. Turn on **Show FPS** in Settings to check performance.

## Deploying to GitHub Pages

1. Push this repository to GitHub. All you need are `index.html`, `style.css` and the `js/` folder.
2. On GitHub go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source: Deploy from a branch**. Pick your branch (for example `main`) and the folder **`/ (root)`**, then click **Save**.
4. After a minute the game is live at `https://<your-username>.github.io/<repo-name>/`.

There's nothing to build. Any static host works too (Netlify, Vercel, itch.io as an HTML game, and so on).

### Running locally
ES modules don't load from `file://` URLs, so serve the folder with any static web server. For example:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. On a Chromebook without a terminal, use GitHub Pages instead.

## Project structure

```
index.html      import map (Three.js r160 + addons, PeerJS) and app shell
style.css       menus, broadcast HUD, animations
js/main.js      app bootstrap, main loop, mode orchestration, replays
js/config.js    constants, difficulty & quality presets, storage helpers
js/sim.js       authoritative 60 Hz game simulation: rules, downs, clock, tackles, passing, fumbles
js/ai.js        AI teammates & opponents (routes, blocking, coverage, pursuit, QB reads, play calling)
js/plays.js     playbook and route diagrams
js/match.js     LocalMatch (fixed timestep + interpolation, network host) and ClientMatch (prediction + interpolation)
js/network.js   PeerJS host/client, room codes, invite links
js/players.js   procedural skinned toon players and procedural animation
js/ball.js      football model
js/field.js     stadium: painted field, grass, stands, instanced crowd, floodlights, jumbotron, sky
js/fx.js        particles, confetti, fireworks, trails, field markers, blob shadows
js/camera.js    broadcast camera, sweeps, replay and celebration cameras, shake
js/render.js    renderer, post-processing (bloom, grade + vignette, FXAA)
js/input.js     keyboard for 1–2 local players
js/audio.js     synthesized crowd, whistle, hits, horn and menu music
js/ui.js        menus, lobby, season, editor, settings, HUD
js/season.js    season schedule, standings, playoffs
js/teams.js     8 original teams, procedural logos, editor overrides
```

All team names, logos and designs are original to this project.

## License

MIT. See [LICENSE](LICENSE).
