const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const blockedElements = new Set(["script", "style", "set", "foreignobject", "iframe", "object", "embed", "audio", "video"]);

export function sanitizeSvgArtwork(source, parser = new DOMParser(), serializer = new XMLSerializer()) {
  if (typeof source !== "string" || !source.trim()) {
    return { valid: false, source: "", error: "SVG source is empty." };
  }
  const document = parser.parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror")) {
    return { valid: false, source: "", error: "SVG markup is malformed." };
  }
  const root = document.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg" || (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE)) {
    return { valid: false, source: "", error: "Artwork root element must be SVG." };
  }

  for (const element of [...root.querySelectorAll("*")]) {
    const tagName = element.localName.toLowerCase();
    if (blockedElements.has(tagName) || tagName.startsWith("animate")) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "style" || /url\s*\(/i.test(value) ||
        ((name === "href" || name.endsWith(":href")) && value && !value.startsWith("#"))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const attribute of [...root.attributes]) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (name.startsWith("on") || name === "style" || /url\s*\(/i.test(value) ||
      ((name === "href" || name.endsWith(":href")) && value && !value.startsWith("#"))) {
      root.removeAttribute(attribute.name);
    }
  }
  return { valid: true, source: serializer.serializeToString(root), error: "" };
}