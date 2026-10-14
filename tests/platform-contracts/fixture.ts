import type { ImagesBinding, ReadableStream } from '@cloudflare/workers-types';

declare const images: ImagesBinding;
declare const input: ReadableStream<Uint8Array>;

// Static call-shape contract only; this file is never executed.
const builder = images.input(input);
const transformed = builder.transform({ rotate: 90 });
const output = transformed.output({ format: 'image/png', anim: false });
output.then(result => {
  const type: string = result.contentType();
  const bytes = result.image();
  const response = result.response();
  return { type, bytes, response };
});
images.info(input);

// Negative sentinels must remain errors, rather than silently becoming `any`.
// @ts-expect-error output requires an explicit format
transformed.output({ anim: false });
// @ts-expect-error unsupported output MIME
transformed.output({ format: 'image/not-a-format' });
// @ts-expect-error rotate is numeric
builder.transform({ rotate: '90' });
// @ts-expect-error no arbitrary output method
output.then(result => result.nonexistentMethod());
