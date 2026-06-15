# AlphaSense Podcast

Turns AlphaSense Deep Research PDFs into a ~20-minute spoken analyst briefing using Claude + your browser's built-in voice.

## Setup (one-time)

```bash
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Open **http://localhost:5000** in Chrome or Edge.

1. Enter your [Anthropic API key](https://console.anthropic.com) (saved in your browser, never sent anywhere except Anthropic)
2. Drop in your AlphaSense PDF
3. Click **Generate Podcast Script** (~30 seconds)
4. Hit **▶** and listen

## Notes

- Works best in **Chrome** or **Edge** (richest Web Speech API voice selection)
- Script is ~4,500 words → roughly 20 minutes at default speed
- Use the speed slider (0.7× – 1.5×) to adjust pace
- Copy the script to paste into any external TTS tool (ElevenLabs, etc.) for higher-quality audio
