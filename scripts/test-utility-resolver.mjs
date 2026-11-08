// Prototype utility class resolver

const TAILWIND_COLORS = {
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
  'emerald-50': '#ecfdf5',
  'emerald-100': '#d1fae5',
  'emerald-200': '#a7f3d0',
  'emerald-300': '#6ee7b7',
  'emerald-400': '#34d399',
  'emerald-500': '#10b981',
  'emerald-600': '#059669',
  'emerald-700': '#047857',
  'emerald-800': '#065f46',
  'emerald-900': '#064e3b',
  'zinc-50': '#fafafa',
  'zinc-100': '#f4f4f5',
  'zinc-200': '#e4e4e7',
  'zinc-300': '#d4d4d8',
  'zinc-400': '#a1a1aa',
  'zinc-500': '#71717a',
  'zinc-600': '#52525b',
  'zinc-700': '#3f3f46',
  'zinc-800': '#27272a',
  'zinc-900': '#18181b',
  'zinc-950': '#09090b',
  'gray-100': '#f3f4f6',
  'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db',
  'gray-400': '#9ca3af',
  'gray-500': '#6b7280',
  'gray-600': '#4b5563',
  'gray-700': '#374151',
  'gray-800': '#1f2937',
  'gray-900': '#111827',
  // Theme semantic variables
  card: '#ffffff',
  background: '#ffffff',
  foreground: '#09090b',
  muted: '#f4f4f5',
  'muted-foreground': '#71717a',
  border: '#e4e4e7',
  primary: '#09090b',
  'primary-foreground': '#fafafa',
};

const SPACING_MAP = {
  '0': '0px',
  '0.5': '2px',
  '1': '4px',
  '1.5': '6px',
  '2': '8px',
  '2.5': '10px',
  '3': '12px',
  '3.5': '14px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '7': '28px',
  '8': '32px',
  '9': '36px',
  '10': '40px',
  '11': '44px',
  '12': '48px',
  '14': '56px',
  '16': '64px',
  '20': '80px',
  '24': '96px',
};

const RADIUS_MAP = {
  none: '0px',
  sm: '2px',
  DEFAULT: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  '2xl': '16px',
  '3xl': '24px',
  full: '9999px',
};

export function resolveUtilityClasses(classStr) {
  if (!classStr || typeof classStr !== 'string') return {};
  const classes = classStr.trim().split(/\s+/);
  const s = {};

  for (const cls of classes) {
    // Skip dark: hover: focus: sm: md: lg: responsive prefixes for base style
    if (cls.includes(':')) {
      // We can optionally support sm: md: or skip
      continue;
    }

    // Display
    if (cls === 'flex') s['display'] = 'flex';
    else if (cls === 'inline-flex') s['display'] = 'inline-flex';
    else if (cls === 'block') s['display'] = 'block';
    else if (cls === 'inline-block') s['display'] = 'inline-block';
    else if (cls === 'grid') s['display'] = 'grid';
    else if (cls === 'hidden') s['display'] = 'none';

    // Flex layout
    else if (cls === 'flex-col') s['flex-direction'] = 'column';
    else if (cls === 'flex-row') s['flex-direction'] = 'row';
    else if (cls === 'flex-wrap') s['flex-wrap'] = 'wrap';
    else if (cls === 'items-center') s['align-items'] = 'center';
    else if (cls === 'items-start') s['align-items'] = 'flex-start';
    else if (cls === 'items-end') s['align-items'] = 'flex-end';
    else if (cls === 'items-stretch') s['align-items'] = 'stretch';
    else if (cls === 'justify-center') s['justify-content'] = 'center';
    else if (cls === 'justify-between') s['justify-content'] = 'space-between';
    else if (cls === 'justify-start') s['justify-content'] = 'flex-start';
    else if (cls === 'justify-end') s['justify-content'] = 'flex-end';

    // Width & Max-Width
    else if (cls === 'w-full') s['width'] = '100%';
    else if (cls === 'w-fit') s['width'] = 'fit-content';
    else if (cls.startsWith('max-w-[')) {
      const m = cls.match(/^max-w-\[([^\]]+)\]$/);
      if (m) s['max-width'] = m[1];
    } else if (cls.startsWith('w-[')) {
      const m = cls.match(/^w-\[([^\]]+)\]$/);
      if (m) s['width'] = m[1];
    }

    // Margins (centering)
    else if (cls === 'mx-auto') {
      s['margin-left'] = 'auto';
      s['margin-right'] = 'auto';
    }

    // Borders
    else if (cls === 'border') {
      s['border-width'] = '1px';
      s['border-style'] = 'solid';
    } else if (cls.startsWith('border-') && /^\d+$/.test(cls.slice(7))) {
      s['border-width'] = `${cls.slice(7)}px`;
      s['border-style'] = 'solid';
    } else if (cls.startsWith('border-')) {
      const colorKey = cls.slice(7);
      if (TAILWIND_COLORS[colorKey]) {
        s['border-color'] = TAILWIND_COLORS[colorKey];
        if (!s['border-width']) s['border-width'] = '1px';
        if (!s['border-style']) s['border-style'] = 'solid';
      }
    }

    // Border Radius
    else if (cls === 'rounded') s['border-radius'] = RADIUS_MAP.DEFAULT;
    else if (cls.startsWith('rounded-')) {
      const rKey = cls.slice(8);
      if (RADIUS_MAP[rKey]) s['border-radius'] = RADIUS_MAP[rKey];
    }

    // Backgrounds
    else if (cls.startsWith('bg-')) {
      const colorKey = cls.slice(3);
      if (TAILWIND_COLORS[colorKey]) {
        s['background-color'] = TAILWIND_COLORS[colorKey];
      }
    }

    // Text Colors
    else if (cls.startsWith('text-')) {
      const colorKey = cls.slice(5);
      if (TAILWIND_COLORS[colorKey]) {
        s['color'] = TAILWIND_COLORS[colorKey];
      }
    }

    // Padding
    else if (cls.startsWith('p-')) {
      const val = cls.slice(2);
      if (SPACING_MAP[val]) s['padding'] = SPACING_MAP[val];
    } else if (cls.startsWith('px-')) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) {
        s['padding-left'] = SPACING_MAP[val];
        s['padding-right'] = SPACING_MAP[val];
      }
    } else if (cls.startsWith('py-')) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) {
        s['padding-top'] = SPACING_MAP[val];
        s['padding-bottom'] = SPACING_MAP[val];
      }
    } else if (cls.startsWith('pt-')) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) s['padding-top'] = SPACING_MAP[val];
    }

    // Spacing / Gaps
    else if (cls.startsWith('gap-')) {
      const val = cls.slice(4);
      if (SPACING_MAP[val]) s['gap'] = SPACING_MAP[val];
    } else if (cls.startsWith('space-y-')) {
      const val = cls.slice(8);
      if (SPACING_MAP[val]) s['row-gap'] = SPACING_MAP[val];
    }

    // Shadows
    else if (cls === 'shadow-md') {
      s['box-shadow'] = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';
    } else if (cls === 'shadow-sm') {
      s['box-shadow'] = '0 1px 2px 0 rgb(0 0 0 / 0.05)';
    } else if (cls === 'shadow') {
      s['box-shadow'] = '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)';
    } else if (cls === 'shadow-lg') {
      s['box-shadow'] = '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)';
    }
  }

  return s;
}

// Test with Context7 card classes
const testClasses = "w-full rounded-3xl border-2 border-emerald-600 bg-card p-6 shadow-md sm:p-8";
console.log('Resolved styles for:', testClasses);
console.log(resolveUtilityClasses(testClasses));
