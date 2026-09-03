# Reveal.js slide geometry defaults

Reveal.js does not default to 1920x1080. Its authored slide canvas defaults to
`960x700`, an aspect ratio of about 1.37:1. The default surrounding margin is
`0.04`, which reserves four percent of the available display around the slide.
Sshelf keeps the `960x700` fallback but deliberately changes the default margin
to `0` for full-bleed PDF export.

The official presentation-size guide lists these values and explains that
Reveal scales the authored canvas uniformly to fit the viewport while preserving
its aspect ratio. A deck that needs 16:9 must set an explicit size such as
`1920x1080` or `1280x720`. These sizes have the same aspect ratio, so the choice
mainly sets the coordinate system used to compose the slides.

```js
Reveal.initialize({
  width: 1920,
  height: 1080,
  margin: 0,
})
```

Reveal applies `width`, `height`, and `margin` to the whole presentation. They
are not per-section settings. The Sshelf integration exposes the same choice as
per-deck metadata on the document root:

```html
<html
  data-sshelf-slides="1"
  data-slide-width="1920"
  data-slide-height="1080"
  data-slide-margin="0"
></html>
```

Sources:

- [Reveal.js presentation-size documentation](https://revealjs.com/presentation-size/)
- [Reveal.js 6.0.1 default configuration source](https://github.com/hakimel/reveal.js/blob/6.0.1/js/config.ts#L852-L860)
- [Reveal.js PDF export documentation](https://revealjs.com/pdf-export/)
