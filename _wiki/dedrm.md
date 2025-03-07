---
date: 2020-09-17 12:02:43 +03:00
last_modified_at: 2022-09-01 17:16:47 +03:00
---

# De-DRM

## e-Books

Tools:

- [Calibre](https://calibre-ebook.com/)
- [DeDRM_tools](https://github.com/apprenticeharper/DeDRM_tools/)

Installation for Calibre:

```
brew cask install calibre
```

For DeDRM: 

[Using the DeDRM plugin with the Calibre command line interface](https://github.com/apprenticeharper/DeDRM_tools/blob/master/CALIBRE_CLI_INSTRUCTIONS.md)

## Audible Audiobooks

Extract encryption keys: <https://github.com/inAudible-NG/audible-activator>

Then:

``` sh
ffmpeg -activation_bytes XXXXXXXX -i in.AAX out.mp3
```

Or for m4b, without transcoding, keeping all metadata:

``` sh
ffmpeg -activation_bytes XXXXXXXX -i in.AAX -c copy out.m4b
```
