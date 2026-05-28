# WaveRoom Music

WaveRoom is an ad-free local music web app. It plays audio files you import from your computer and stores imported tracks in the browser's local library when IndexedDB is available.

## Run

Open `index.html` directly, or serve the folder locally:

```powershell
python -m http.server 4173
```

Then visit `http://localhost:4173`.

## Notes

- The included demo tracks are procedurally generated in the browser.
- The app does not bypass licensing, remove ads from another service, or stream copyrighted catalogs.
- Imported files stay local to your browser storage.
