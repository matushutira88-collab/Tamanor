// V1.72 (Release C1) — Twitter/X card reuses the same branded OpenGraph image so summary_large_image
// never renders blank. (runtime intentionally not re-exported — the default runtime renders it fine.)
export { default, alt, size, contentType } from "./opengraph-image";
