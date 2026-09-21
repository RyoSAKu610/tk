# ResearchPhantom — image-to-video scene prompt

Use this as a worksheet. Replace every `{{...}}` field with facts from the public abstract or paper. Do not send credentials, private notes, or unpublished paper text to an external service.

## Scene contract

- Paper id: `{{PAPER_ID}}`
- Scene id: `{{question|input|process|caution|observation|interpretation|conclusion}}`
- Source-backed fact: `{{ONE_SENTENCE_FROM_THE_PUBLIC_ABSTRACT}}`
- Guide character: `{{ORIGINAL_GUIDE_NAME_AND_ROLE}}`
- Reference image: `{{USER_OWNED_OR_AUTHORIZED_IMAGE}}`
- Target duration: `{{4-10}} seconds`
- Aspect ratio: `9:16`

## Prompt for Grok Imagine or another image-to-video tool

Animate the supplied original guide illustration as a restrained educational paper-theater shot. The character performs one clear action that visualizes this source-backed fact: "{{SOURCE_BACKED_FACT}}". Keep the character identity, face, clothing, props, and proportions consistent with the reference. Use subtle breathing, one natural blink, a small hand gesture toward the relevant prop, gentle cloth and paper secondary motion, and a slow 3% camera push-in. Preserve generous negative space for Japanese captions. Warm archival paper, ink, brass, and deep indigo palette; readable silhouette; stable hands and eyes; coherent lighting; no scene cut.

Do not add claims, numbers, labels, diagrams, dialogue, logos, fake brand marks, or on-screen text. Preserve any platform-added AI provenance mark or watermark exactly as exported; never ask the generator or importer to remove, crop, obscure, or alter it. Do not imitate a named living artist, commercial animation franchise, or copyrighted character. Do not transform the historical guide into the paper's author. The guide is only a narrator. End in a pose close enough to the opening pose for a soft loop.

Negative constraints: identity drift, face morphing, extra fingers, duplicated limbs, melting props, random symbols, unreadable text, camera shake, rapid zoom, flashing, strobing, hard cuts, lip movements without supplied dialogue, invented experimental results.

Export as MP4 or WebM. Audio is not needed; ResearchPhantom supplies narration and captions separately.

## Review before import

1. The motion illustrates only the cited fact and does not invent a result.
2. Character identity and small props remain stable through the full clip.
3. There is no embedded voice, user-authored text, fake logo, or flashing content. Platform provenance marks remain intact.
4. You own or are permitted to publish the reference and generated output.
5. Save this filled prompt beside the export, then run the importer with `--prompt-file` and `--rights-confirmed`.
