# Tweet / Social Card Embeds

Render a faithful, on-brand preview of a real tweet (X/Twitter) on a slide. The `.tweet-card` and `.tweet-media` styles ship in `base-styles.css`, so you only need to fetch the data, save the images locally, and fill in the template.

## 1. Fetch the real tweet data (no login required)

A tweet URL looks like `https://x.com/<user>/status/<TWEET_ID>`. Pass the trailing `<TWEET_ID>` to the public syndication endpoint:

```bash
curl -s "https://cdn.syndication.twimg.com/tweet-result?id=<TWEET_ID>&lang=en&token=a"
```

If `curl` is blocked by the sandbox, `WebFetch` the same URL instead. Do **not** fetch the `x.com` page itself — it is JS-walled and returns `402`, so the syndication endpoint is the reliable source.

Relevant JSON fields:

| Field | Use |
| --- | --- |
| `text` | Tweet text (use verbatim) |
| `user.name` | Display name (e.g. `clem 🤗`) |
| `user.screen_name` | `@handle` |
| `user.is_blue_verified` | Show the blue check if `true` |
| `user.profile_image_url_https` | Avatar URL — download it in step 2 |
| `created_at` | ISO timestamp → format like `7:39 PM · Jun 5, 2026` |
| `favorite_count` | Likes |
| `conversation_count` | Replies |
| `mediaDetails[].media_url_https` | Attached photo(s), if any |

**Faithfulness rules:**
- Quote `text` verbatim. Strip a trailing `https://t.co/…` only when it is the link to attached media.
- This endpoint does **not** return repost or view counts — show only the metrics you actually have (likes, replies). Never fabricate numbers.

## 2. Save the images locally (always do this)

Never hot-link `pbs.twimg.com` URLs from the slide — they break offline, on networks that block Twitter's CDN, and in PDF export. Download the avatar and any attached media into the presentation folder so the deck is self-contained:

```bash
mkdir -p <deck-dir>/images
# Avatar — upscale by swapping _normal for _400x400 in the URL:
curl -s "https://pbs.twimg.com/profile_images/<…>_400x400.jpg" -o <deck-dir>/images/<handle>-avatar.jpg
# Attached media (from mediaDetails[].media_url_https), if any:
curl -s "<media_url_https>" -o <deck-dir>/images/<name>.jpg
```

Then reference them with relative paths (`images/…`) in the templates below.

## 3. Text-only tweet

Center the card on a light slide; a faint tint such as `#f6f4fb` makes the white card pop. Split a multi-paragraph tweet on its blank lines into separate `.tweet-body` paragraphs.

```html
<section id="tweet" data-background-color="#f6f4fb">
  <p class="eyebrow">From the field</p>
  <h2>Optional framing headline</h2>
  <div class="content" style="align-items: center; justify-content: center;">
    <div class="tweet-card fragment fade-up">
      <div class="tweet-head">
        <img class="tweet-avatar" src="images/clem-avatar.png" alt="avatar">
        <div style="flex: 1; min-width: 0;">
          <p class="tweet-name">clem 🤗 <i class="fa-solid fa-circle-check tweet-badge"></i></p>
          <p class="tweet-handle">@ClementDelangue</p>
        </div>
        <i class="fa-brands fa-x-twitter tweet-logo"></i>
      </div>
      <p class="tweet-body">First paragraph of the tweet, verbatim.</p>
      <p class="tweet-body">Second paragraph, if any.</p>
      <p class="tweet-meta">7:39 PM · Jun 5, 2026</p>
      <div class="tweet-stats">
        <p><i class="fa-regular fa-comment"></i> 90</p>
        <p><i class="fa-solid fa-heart" style="color: #f91880;"></i> 543</p>
        <p style="margin-left: auto;"><i class="fa-solid fa-arrow-up-from-bracket"></i></p>
      </div>
    </div>
  </div>
</section>
```

Notes:
- Drop the `tweet-badge` `<i>` if the account isn't verified.
- The card has a brand purple→pink strip along its top (driven by `--primary-color` / `--secondary-color`).
- `fragment fade-up` animates the card in. If your deck defines the custom `.rise` / `.pop` fragments (see [advanced-features.md](advanced-features.md)), use `fragment rise` instead.

## 4. Tweet with an attached image

When the tweet incorporates an image (`mediaDetails`), put the **card on the left and the image on the right** in a two-column grid so both stay readable. The image reveals nicely as its own fragment.

```html
<section id="tweet-media" data-background-color="#f6f4fb">
  <p class="eyebrow">Reality check</p>
  <h2>Framing headline</h2>
  <div class="content">
    <div style="display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 44px; flex: 1; min-height: 0;">
      <div style="display: flex; flex-direction: column; justify-content: center; min-width: 0;">
        <div class="tweet-card">
          <!-- same .tweet-head / .tweet-body / .tweet-meta / .tweet-stats as in section 3 -->
        </div>
      </div>
      <div class="tweet-media fragment rise">
        <img src="images/<name>.jpg" style="max-height: 470px;" alt="describe the image">
      </div>
    </div>
  </div>
</section>
```

**Gotcha — always cap the image height.** A portrait/tall image overflows the slide because a percentage `max-height` can't resolve against an auto-sized grid row. Set an explicit pixel `max-height` on the `<img>` (≈`470px` for a slide with a title above), then run `check-overflow.js`.

To embed the image **inside** the card instead (single-column authentic embed), drop it below the body paragraphs — best for landscape images that aren't too tall:

```html
<img src="images/<name>.jpg" style="width: 100%; border-radius: 12px; margin-top: 4px;" alt="describe the image">
```

Keep any source/author attribution visible in an attached chart or screenshot — don't crop it out.
