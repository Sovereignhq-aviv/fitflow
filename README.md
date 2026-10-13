# FitFlow

An Android app, and the same thing as a web page. A food and training log with
no account and no server: your data stays in the app's own storage and is never
uploaded anywhere.

## What it does

**Today** — search a built-in list of ~74 common foods (or add your own), pick a
portion in grams, and it logs the calories and macros. A dial shows calories left
against your target; three bars show protein, carbs and fat. Weigh-ins go in here too.

Two faster ways in:

- **Describe it** — type "two scrambled eggs, a slice of toast with butter", or
  photograph the plate or the nutrition label, and Claude works out the weights
  and macros. You see every assumption it made ("2 large eggs at 55 g each"),
  can change any weight, and can drop any item. Nothing is logged until you
  confirm. On the published claude.ai page this needs no setup at all — the page
  is lent Claude directly and runs on your own Claude account. Photos work only
  on that route.
- **Scan barcode** — point the camera at a packet, or type the number underneath.
  Nutrition comes from Open Food Facts. Scanned products are saved into your own
  food list, so the second scan of the same thing works offline. This one needs
  the server: the claude.ai page is walled off from other sites.

**Gym** — log a session as exercises with sets of weight × reps. Each exercise shows
what you lifted last time so you know what to beat, plus session volume, estimated
one-rep max, and a PR flag when you beat your best.

**Progress** — long-term goal (target weight, % of the way there, projected finish
date from your actual 4-week trend), this week (gym sessions and days on target),
a weight chart, 14 days of calories against target, and your best lift per exercise.

**You** — age, height, weight, sex and activity level. From those it works out what
you burn (Mifflin-St Jeor × activity factor), applies your goal and pace, and sets
daily calorie and macro targets. Every number can be overridden by hand.

## Installing it on a phone

Open this on the phone and the download starts — no account, no sign-in:

**https://github.com/Sovereignhq-aviv/fitflow/releases/latest/download/FitFlow.apk**

That link always points at the newest release. Android will ask once for
permission to install from your browser.

Only releases from **v1.1** onwards share a signing key, so a later version
installs straight over an earlier one. v1.0 was signed with a throwaway key and
would have to be uninstalled first.

Everything works in the app with nothing configured: food search, logging, the
gym log, progress, and barcode scanning. Describing a meal in words needs an
Anthropic API key pasted into **You → Smart entry**; the app calls Claude itself,
so there is no server in the middle.

### Moving your log into the app

The log lives in each copy's own storage, so the app starts empty. On the
claude.ai page use **You → Export backup**, then in the app **You → Import
backup**. That is also how you move between phones.

## Running it on a computer

`index.html` on its own is the whole tracker — open it in a browser and it works.

For the server version, which keeps an API key out of the browser:

```bash
npm install
```

```bash
node server.mjs
```

Then open `http://localhost:8744`. The startup lines say which features are on.

### Where the AI comes from

The app takes whichever of three routes the copy it is running in has:

| Route | Where | Setup | Photos |
|---|---|---|---|
| `sample` | the claude.ai page | none — Claude comes with the page | yes |
| `direct` | the installed app, or any plain copy | your API key, pasted into the app | yes |
| `server` | `node server.mjs` | `ANTHROPIC_API_KEY`, or a key pasted into the app | no |

Barcode lookup goes straight to Open Food Facts from the page, except on the
claude.ai page, which is walled off from other sites and hides the button.

### Deploying the server version

Set these on any host that runs `npm start`:

| Variable | Why |
|---|---|
| `ANTHROPIC_API_KEY` | enables plain-words entry without anyone pasting a key |
| `FITFLOW_TOKEN` | **required for a public deploy** — a shared code the app must send before `/api/parse` will spend anything |

Without `FITFLOW_TOKEN`, `/api/parse` refuses every request that is not from
localhost, so a public URL cannot burn your API credit by accident.

## Building the app

`.github/workflows/build-apk.yml` builds the APK in the cloud; nothing Android
has to be installed locally. Every push attaches an APK to the run, and pushing
a `v*` tag publishes a release.

```bash
git tag -a v1.2 -m "what changed" && git push origin main --follow-tags
```

The signing key lives in the `DEBUG_KEYSTORE_B64` repository secret. Every build
must use it or Android refuses to install the new version over the old one.

`android/` holds the shell: a WebView that serves the bundled `index.html`
through `WebViewAssetLoader`. That gives the page a real https origin, which is
what lets it use the camera and call Claude and Open Food Facts — a `file://`
page is an opaque origin that all three refuse. Gradle copies `index.html` into
assets at build time, so the root file stays the only copy. Launcher icons are
drawn by `tools/make-icons.mjs`.

## The published version

`dist/artifact.html` is the same app packaged for claude.ai hosting, generated by:

```bash
node build-artifact.mjs
```

Never edit `dist/artifact.html` directly — edit `index.html` and rebuild. The
markers `<!--ARTIFACT:HEAD-START-->` and `<!--ARTIFACT:BODY-START-->` in
`index.html` are what the build script slices on.

The claude.ai host blocks outbound connections from the page, so barcode lookup
is never available there and the button hides itself. Plain-words entry *is*
available there, through the page's `sample` capability — which is why the
artifact is published declaring `sample` and `downloads`. Changing that
declaration means passing `capabilities` explicitly on the next publish.

## Data

Everything is under the `fitflow.v1` key in `localStorage`. That means:

- It is per-browser and per-device. Phone and laptop keep separate logs.
- Clearing site data erases it.
- **You → Export backup** writes a JSON file; **Import backup** reads it back.
  That is the only way to move data between devices.

Logged food entries store their own calorie and macro numbers, so editing or
deleting a food later never rewrites days you already logged. The same applies to
anything the AI or a barcode produced — once logged, the numbers are frozen.

The access code is kept under a separate `fitflow.token` key and is deliberately
left out of backups, so an exported file can be moved around without carrying it.

## Nutrition numbers

Food values are per 100 g from standard reference data, rounded. They are close
enough for tracking trends, not lab-accurate — brands vary. Anything you eat often
is worth adding yourself from the label via **New food**.

The same caution applies harder to plain-words entry: it is an estimate of an
estimate, since it has to guess your portion size as well as the food. That is why
the app shows you every assumption and lets you correct the weight before logging.
Barcode data is crowd-sourced and occasionally wrong; check it against the packet
the first time you scan something.

Calorie targets use Mifflin-St Jeor for BMR, an activity multiplier for daily
burn, and 7,700 kcal per kg of body fat for the deficit or surplus. Protein is set
at 2.2 g/kg when cutting and 1.8 g/kg otherwise; fat at 0.8 g/kg with a floor of
20% of calories; carbohydrate takes the remainder.
