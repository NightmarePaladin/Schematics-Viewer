-- New markup annotation types. Kept in its own migration: a new enum value cannot be used in the transaction that adds it.
--   pen       freehand stroke (points in `path`)
--   arrow     two points in `path` (tail -> head)
--   highlight translucent rectangle (x, y, width, height like a box)
alter type public.annotation_type add value if not exists 'pen';
alter type public.annotation_type add value if not exists 'arrow';
alter type public.annotation_type add value if not exists 'highlight';
