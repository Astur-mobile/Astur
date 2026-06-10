import type { MobileElementSnapshot } from '@astur-mobile/protocol';

export function parseUiAutomatorXml(xml: string): MobileElementSnapshot {
  const children = [...xml.matchAll(/<node\b[^>]*>/g)].map((match) => {
    const attributes = parseAttributes(match[0]);
    const bounds = parseBounds(attributes.bounds);
    const resourceId = emptyToUndefined(attributes['resource-id']);
    const text = emptyToUndefined(attributes.text);
    const label = emptyToUndefined(attributes['content-desc']);

    return {
      id: resourceId,
      text,
      label,
      value: text,
      type: attributes.class || 'android.view.View',
      enabled: attributes.enabled !== 'false',
      visible: bounds.width > 0 && bounds.height > 0,
      selected: attributes.selected === 'true',
      focused: attributes.focused === 'true',
      bounds,
      platform: 'android' as const,
      children: [],
      raw: attributes
    };
  });

  return {
    type: 'android.root',
    enabled: true,
    visible: true,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    platform: 'android',
    children
  };
}

function parseAttributes(node: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const match of node.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]);
  }

  return attributes;
}

function parseBounds(value: string | undefined) {
  const match = value?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value ? value : undefined;
}
