# The theme table. Run: python3 tools/themes/build.py  (rewrites the block between THEMES:BEGIN and THEMES:END in assets/css/app.css)
# Generates the theme token blocks for assets/css/app.css (between THEMES:BEGIN and THEMES:END).
import os, re
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

SYS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", Roboto, "Inter", "LE Inter", "Helvetica Neue", Arial, system-ui, sans-serif'
SYS_D = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, "Inter", "LE Inter", "Helvetica Neue", Arial, system-ui, sans-serif'
JAK = '"Plus Jakarta Sans", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif'

def status(dark):
    if dark:
        return {'--ok': '#65BF88', '--ok-fill': '#3CA368', '--private': '#65BF88', '--private-soft': '#12301E', '--warn': '#EDBD7B', '--warn-soft': '#3A270B',
                '--err': '#FE7C75', '--err-soft': '#421C19', '--add-bg': '#12301E', '--del-bg': '#421C19', '--warm-ink': '#FEB38C', '--warm-soft': '#3F2314'}
    return {'--ok': '#016D3C', '--ok-fill': '#14874E', '--private': '#016D3C', '--private-soft': '#EEFBF1', '--warn': '#7A5103', '--warn-soft': '#FFF5E9',
            '--err': '#C92F33', '--err-soft': '#FFF4F3', '--add-bg': '#EEFBF1', '--del-bg': '#FFF4F3', '--warm-ink': '#913F04', '--warm-soft': '#FFF4EF'}

# ---------------------------------------------------------------- Lapis: pass 2 exactly
LAPIS = {
 'shared': {
  '--font': JAK, '--font-display': 'var(--font)', '--root-size': '100%',
  '--text-xs': '0.75rem', '--text-sm': '0.875rem', '--text-md': '1rem', '--text-md-phone': '1rem', '--text-lg': '1.125rem', '--text-xl': '1.375rem', '--text-2xl': '1.75rem', '--text-3xl': '2.25rem', '--text-4xl': '3rem', '--text-5xl': '4.25rem',
  '--h1-weight': '700', '--h1-tracking': '-0.035em', '--h2-weight': '680', '--h2-tracking': '-0.025em', '--h3-weight': '650', '--hero-weight': '720', '--hero-tracking': '-0.045em', '--body-tracking': '-0.003em', '--eyebrow-case': 'uppercase', '--eyebrow-tracking': '0.1em', '--eyebrow-weight': '680',
  '--start-title-font': 'var(--display)', '--start-title-weight': '400', '--start-title-tracking': '-0.02em', '--accent-font': 'var(--display)', '--accent-style': 'italic', '--accent-weight': '400', '--accent-color': 'inherit', '--accent-tracking': '-0.01em', '--accent-size': '1em', '--hero-accent-size': '1.06em',
  '--r-xs': '6px', '--r-sm': '10px', '--r-md': '14px', '--r-lg': '20px', '--r-xl': '28px', '--r-pill': '999px', '--radius': '20px', '--radius-sm': '14px', '--radius-xs': '10px',
  '--btn-radius': '999px', '--btn-weight': '640', '--btn-size': '15px', '--field-radius': 'var(--r-sm)', '--seg-radius': '999px', '--seg-inner-radius': '999px', '--chip-radius': '999px', '--card-radius': 'var(--r-lg)', '--sheet-radius': '22px',
  '--hair-w': '1px', '--focus-w': '2px', '--target': '44px',
  '--bar-filter': 'saturate(1.4) blur(14px)', '--sheet-filter': 'none',
  '--ease': 'cubic-bezier(0.23, 1, 0.32, 1)', '--ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)', '--ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)', '--ease-spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur-1': '120ms', '--dur-2': '200ms', '--dur-3': '320ms', '--dur-4': '480ms',
 },
 'light': {
  '--bg': '#FAFAFA', '--bg-2': '#F0F0F0', '--surface': '#FFFFFF', '--surface-2': '#F5F5F5', '--surface-3': '#EBEBEB', '--surface-glass': 'rgba(255, 255, 255, 0.86)',
  '--fill': 'var(--surface-2)', '--fill-2': 'var(--surface-3)',
  '--ink': '#141414', '--text': '#141414', '--muted': '#525252', '--faint': '#6C6C6C', '--line': 'rgba(0, 0, 0, 0.08)', '--border': '#E3E3E3', '--border-hover': '#C1C1C1', '--border-strong': '#8A8A8A',
  '--primary': '#3F67D9', '--primary-hover': '#365CC9', '--primary-active': '#2E51B6', '--on-primary': '#FFFFFF', '--primary-edge': '#3F67D9',
  '--accent': '#2E51B6', '--accent-soft': 'rgba(63, 103, 217, 0.10)', '--accent-softer': 'rgba(63, 103, 217, 0.06)', '--selected-bg': '#F3F7FF', '--selected-edge': '#3F67D9',
  '--focus-ring': '#3F67D9', '--selection-bg': '#CEDDFF', '--selection-ink': '#141414', '--warm': '#EF8C57', '--agent': '#B3510B',
  '--side': '#161616', '--side-2': '#202020', '--side-text': '#E9E9E9', '--side-strong': '#FFFFFF', '--side-dim': '#A3A3A3', '--side-active': '#2A2A2A', '--side-hover': 'rgba(255, 255, 255, 0.08)', '--side-line': 'rgba(255, 255, 255, 0.08)',
  '--inverse-bg': '#161616', '--inverse-text': '#E9E9E9', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#ABABAB', '--toast-bg': '#161616',
  '--btn-bg': 'var(--surface)', '--btn-border': 'var(--border)', '--btn-shadow': 'var(--shadow-xs)', '--btn-hover-bg': 'var(--surface-2)', '--btn-hover-border': 'var(--border-hover)',
  '--btn-primary-shadow': 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 1px 2px rgba(0, 0, 0, 0.14)', '--btn-primary-hover-shadow': 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 6px 16px -8px rgba(63, 103, 217, 0.6)',
  '--field-bg': 'var(--surface)', '--field-border': 'var(--border)', '--seg-track': 'var(--surface-2)', '--seg-border': 'var(--line)', '--seg-on': 'var(--surface)',
  '--chip-bg': 'var(--surface)', '--chip-border': 'var(--border)', '--card-border': 'var(--line)', '--card-shadow': 'var(--shadow-xs)',
  '--bar-bg': 'color-mix(in srgb, var(--bg) 88%, transparent)', '--bar-solid': 'var(--bg)', '--bar-border': 'var(--line)', '--sheet-bg': 'var(--surface)',
  '--shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.06)', '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.08)', '--shadow': '0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 32px -12px rgba(0, 0, 0, 0.14)', '--shadow-lg': '0 2px 4px rgba(0, 0, 0, 0.04), 0 32px 72px -20px rgba(0, 0, 0, 0.26)',
  '--aurora': 'var(--primary)', '--sky': '#E6EEFF', '--sky-ink': '#182D6B', '--peach': '#FFE9DE', '--peach-ink': '#723001', '--brand-soft': 'var(--selected-bg)',
 },
 'dark': {
  '--bg': '#141414', '--bg-2': '#191919', '--surface': '#1C1C1C', '--surface-2': '#262626', '--surface-3': '#2E2E2E', '--surface-glass': 'rgba(28, 28, 28, 0.86)',
  '--fill': 'var(--surface-2)', '--fill-2': 'var(--surface-3)',
  '--ink': '#EDEDED', '--text': '#EDEDED', '--muted': '#BDBDBD', '--faint': '#A3A3A3', '--line': 'rgba(255, 255, 255, 0.09)', '--border': '#333333', '--border-hover': '#4D4D4D', '--border-strong': '#808080',
  '--primary': '#3F67D9', '--primary-hover': '#365CC9', '--primary-active': '#2E51B6', '--on-primary': '#FFFFFF', '--primary-edge': '#5884F8',
  '--accent': '#ADC6FF', '--accent-soft': 'rgba(129, 166, 254, 0.16)', '--accent-softer': 'rgba(129, 166, 254, 0.08)', '--selected-bg': '#1E2A47', '--selected-edge': '#81A6FE',
  '--focus-ring': '#81A6FE', '--selection-bg': '#2E51B6', '--selection-ink': '#FFFFFF', '--warm': '#EF8C57', '--agent': '#B3510B',
  '--side': '#161616', '--side-2': '#1E1E1E', '--side-text': '#E9E9E9', '--side-strong': '#FFFFFF', '--side-dim': '#A3A3A3', '--side-active': '#2A2A2A', '--side-hover': 'rgba(255, 255, 255, 0.08)', '--side-line': 'rgba(255, 255, 255, 0.08)',
  '--inverse-bg': 'var(--surface)', '--inverse-text': '#E9E9E9', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#ABABAB', '--toast-bg': '#2A2A2A',
  '--btn-bg': 'var(--surface)', '--btn-border': 'var(--border)', '--btn-shadow': 'var(--shadow-xs)', '--btn-hover-bg': 'var(--surface-2)', '--btn-hover-border': 'var(--border-hover)',
  '--btn-primary-shadow': 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 1px 2px rgba(0, 0, 0, 0.14)', '--btn-primary-hover-shadow': 'inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 6px 16px -8px rgba(63, 103, 217, 0.6)',
  '--field-bg': 'var(--surface)', '--field-border': 'var(--border)', '--seg-track': 'var(--surface-2)', '--seg-border': 'var(--line)', '--seg-on': 'var(--surface-3)',
  '--chip-bg': 'var(--surface)', '--chip-border': 'var(--border)', '--card-border': 'var(--line)', '--card-shadow': 'var(--shadow-xs)',
  '--bar-bg': 'color-mix(in srgb, var(--bg) 88%, transparent)', '--bar-solid': 'var(--bg)', '--bar-border': 'var(--line)', '--sheet-bg': 'var(--surface)',
  '--shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.3)', '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 12px -4px rgba(0, 0, 0, 0.4)', '--shadow': '0 1px 2px rgba(0, 0, 0, 0.3), 0 16px 40px -16px rgba(0, 0, 0, 0.6)', '--shadow-lg': '0 2px 4px rgba(0, 0, 0, 0.3), 0 32px 80px -20px rgba(0, 0, 0, 0.7)',
  '--aurora': '#81A6FE', '--sky': '#1E2A47', '--sky-ink': '#CEDDFF', '--peach': '#3F2314', '--peach-ink': '#FFD3BD', '--brand-soft': 'var(--selected-bg)',
 },
}
for k in ('light', 'dark'):
    LAPIS[k].update(status(k == 'dark'))

def derive(base, shared=None, light=None, dark=None):
    t = {'shared': dict(base['shared']), 'light': dict(base['light']), 'dark': dict(base['dark'])}
    t['shared'].update(shared or {}); t['light'].update(light or {}); t['dark'].update(dark or {})
    return t

# ---------------------------------------------------------------- Clear: the default
CLEAR = derive(LAPIS,
 shared={
  '--font': SYS, '--font-display': SYS_D,
  '--text-xs': '0.75rem', '--text-sm': '0.875rem', '--text-md': '1rem', '--text-md-phone': '1.0625rem', '--text-lg': '1.25rem', '--text-xl': '1.375rem', '--text-2xl': '1.75rem', '--text-3xl': '2.5rem', '--text-4xl': '3.5rem', '--text-5xl': '4.5rem',
  '--h1-weight': '700', '--h1-tracking': '-0.025em', '--h2-weight': '650', '--h2-tracking': '-0.02em', '--h3-weight': '600', '--hero-weight': '700', '--hero-tracking': '-0.035em', '--body-tracking': '-0.01em', '--eyebrow-case': 'none', '--eyebrow-tracking': '0', '--eyebrow-weight': '600',
  '--start-title-font': 'var(--font-display)', '--start-title-weight': '700', '--start-title-tracking': '-0.03em', '--accent-font': 'inherit', '--accent-style': 'normal', '--accent-weight': 'inherit', '--accent-color': 'var(--muted)', '--accent-tracking': 'inherit', '--accent-size': '1em', '--hero-accent-size': '1em',
  '--r-xs': '6px', '--r-sm': '10px', '--r-md': '12px', '--r-lg': '18px', '--r-xl': '24px', '--radius': '18px', '--radius-sm': '12px', '--radius-xs': '10px',
  '--btn-weight': '590', '--btn-size': '15px', '--field-radius': '10px', '--seg-radius': '9px', '--seg-inner-radius': '7px', '--chip-radius': '999px', '--card-radius': '18px', '--sheet-radius': '26px',
  '--bar-filter': 'saturate(1.8) blur(20px)', '--sheet-filter': 'saturate(1.8) blur(24px)',
  '--ease': 'cubic-bezier(0.25, 0.1, 0.25, 1)', '--ease-out': 'cubic-bezier(0.32, 0.72, 0, 1)', '--ease-in-out': 'cubic-bezier(0.42, 0, 0.58, 1)', '--ease-spring': 'cubic-bezier(0.2, 0.9, 0.25, 1.06)',
  '--dur-1': '150ms', '--dur-2': '250ms', '--dur-3': '350ms', '--dur-4': '480ms',
 },
 light={
  '--bg': '#F5F5F7', '--bg-2': '#EDEDF0', '--surface': '#FFFFFF', '--surface-2': '#F5F5F7', '--surface-3': '#E8E8ED', '--surface-glass': 'rgba(255, 255, 255, 0.72)',
  '--fill': 'rgba(120, 120, 128, 0.12)', '--fill-2': 'rgba(120, 120, 128, 0.2)',
  '--ink': '#1D1D1F', '--text': '#1D1D1F', '--muted': '#5E5E63', '--faint': '#68686D', '--line': 'rgba(60, 60, 67, 0.16)', '--border': '#D2D2D7', '--border-hover': '#B0B0B5', '--border-strong': '#86868B',
  '--primary': '#0369DA', '--primary-hover': '#035FC5', '--primary-active': '#0356B4', '--on-primary': '#FFFFFF', '--primary-edge': '#0369DA',
  '--accent': '#035FC5', '--accent-soft': 'rgba(3, 105, 218, 0.10)', '--accent-softer': 'rgba(3, 105, 218, 0.06)', '--selected-bg': '#E6F0FB', '--selected-edge': '#0369DA',
  '--focus-ring': '#0369DA', '--selection-bg': '#B9D7FB', '--selection-ink': '#1D1D1F',
  '--side': '#F7F7F7', '--side-2': '#EFEFF2', '--side-text': '#1D1D1F', '--side-strong': '#000000', '--side-dim': '#5E5E63', '--side-active': 'rgba(120, 120, 128, 0.16)', '--side-hover': 'rgba(120, 120, 128, 0.12)', '--side-line': 'rgba(60, 60, 67, 0.14)',
  '--inverse-bg': '#000000', '--inverse-text': '#F5F5F7', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#A1A1A6', '--toast-bg': 'rgba(29, 29, 31, 0.92)',
  '--btn-bg': 'var(--fill)', '--btn-border': 'transparent', '--btn-shadow': 'none', '--btn-hover-bg': 'var(--fill-2)', '--btn-hover-border': 'transparent',
  '--btn-primary-shadow': 'none', '--btn-primary-hover-shadow': 'none',
  '--field-bg': 'var(--surface)', '--field-border': 'var(--border)', '--seg-track': 'var(--fill)', '--seg-border': 'transparent', '--seg-on': 'var(--surface)',
  '--chip-bg': 'var(--fill)', '--chip-border': 'transparent', '--card-border': 'transparent', '--card-shadow': 'none',
  '--bar-bg': 'rgba(245, 245, 247, 0.72)', '--bar-solid': '#F5F5F7', '--bar-border': 'var(--line)', '--sheet-bg': 'rgba(255, 255, 255, 0.86)',
  '--shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.04)', '--shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 14px rgba(0, 0, 0, 0.05)', '--shadow': '0 4px 24px rgba(0, 0, 0, 0.08)', '--shadow-lg': '0 2px 8px rgba(0, 0, 0, 0.06), 0 18px 56px rgba(0, 0, 0, 0.16)',
  '--aurora': 'var(--primary)', '--sky': 'rgba(3, 105, 218, 0.10)', '--sky-ink': '#0356B4',
 },
 dark={
  '--bg': '#000000', '--bg-2': '#111112', '--surface': '#1C1C1E', '--surface-2': '#2C2C2E', '--surface-3': '#3A3A3C', '--surface-glass': 'rgba(28, 28, 30, 0.72)',
  '--fill': 'rgba(120, 120, 128, 0.24)', '--fill-2': 'rgba(120, 120, 128, 0.36)',
  '--ink': '#F5F5F7', '--text': '#F5F5F7', '--muted': '#AEAEB2', '--faint': '#A1A1A6', '--line': 'rgba(84, 84, 88, 0.6)', '--border': '#38383A', '--border-hover': '#545458', '--border-strong': '#8E8E93',
  '--primary': '#0369DA', '--primary-hover': '#035FC5', '--primary-active': '#035FC5', '--on-primary': '#FFFFFF', '--primary-edge': '#3A85EA',
  '--accent': '#61A2FD', '--accent-soft': 'rgba(97, 162, 253, 0.18)', '--accent-softer': 'rgba(97, 162, 253, 0.10)', '--selected-bg': '#283446', '--selected-edge': '#61A2FD',
  '--focus-ring': '#61A2FD', '--selection-bg': '#0356B4', '--selection-ink': '#FFFFFF',
  '--side': '#1C1C1E', '--side-2': '#2C2C2E', '--side-text': '#F5F5F7', '--side-strong': '#FFFFFF', '--side-dim': '#AEAEB2', '--side-active': 'rgba(120, 120, 128, 0.32)', '--side-hover': 'rgba(120, 120, 128, 0.24)', '--side-line': 'rgba(84, 84, 88, 0.6)',
  '--inverse-bg': '#1C1C1E', '--inverse-text': '#F5F5F7', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#AEAEB2', '--toast-bg': 'rgba(58, 58, 60, 0.94)',
  '--btn-bg': 'var(--fill)', '--btn-border': 'transparent', '--btn-shadow': 'none', '--btn-hover-bg': 'var(--fill-2)', '--btn-hover-border': 'transparent',
  '--btn-primary-shadow': 'none', '--btn-primary-hover-shadow': 'none',
  '--field-bg': 'var(--surface-2)', '--field-border': 'var(--border)', '--seg-track': 'var(--fill)', '--seg-border': 'transparent', '--seg-on': '#636366',
  '--chip-bg': 'var(--fill)', '--chip-border': 'transparent', '--card-border': 'transparent', '--card-shadow': 'none',
  '--bar-bg': 'rgba(22, 22, 23, 0.72)', '--bar-solid': '#161617', '--bar-border': 'var(--line)', '--sheet-bg': 'rgba(28, 28, 30, 0.86)',
  '--shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.4)', '--shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.4)', '--shadow': '0 8px 32px rgba(0, 0, 0, 0.5)', '--shadow-lg': '0 2px 8px rgba(0, 0, 0, 0.4), 0 24px 64px rgba(0, 0, 0, 0.6)',
  '--aurora': '#61A2FD', '--sky': 'rgba(97, 162, 253, 0.18)', '--sky-ink': '#B9D7FB',
 })

# ---------------------------------------------------------------- Graphite: monochrome, dense, square, no translucency
GRAPHITE = derive(CLEAR,
 shared={
  '--text-sm': '0.8125rem', '--text-md': '0.9375rem', '--text-md-phone': '1rem', '--text-lg': '1.0625rem', '--text-3xl': '2rem', '--text-4xl': '2.75rem', '--text-5xl': '3.5rem',
  '--h1-weight': '650', '--h1-tracking': '-0.02em', '--h2-weight': '600', '--hero-weight': '650', '--hero-tracking': '-0.03em', '--body-tracking': '0', '--eyebrow-case': 'uppercase', '--eyebrow-tracking': '0.08em', '--eyebrow-weight': '650',
  '--accent-color': 'inherit',
  '--r-xs': '3px', '--r-sm': '4px', '--r-md': '6px', '--r-lg': '8px', '--r-xl': '10px', '--radius': '8px', '--radius-sm': '6px', '--radius-xs': '4px',
  '--btn-radius': '6px', '--btn-weight': '560', '--btn-size': '14px', '--field-radius': '4px', '--seg-radius': '6px', '--seg-inner-radius': '4px', '--chip-radius': '4px', '--card-radius': '8px', '--sheet-radius': '10px',
  '--bar-filter': 'none', '--sheet-filter': 'none',
  '--ease': 'cubic-bezier(0.2, 0, 0, 1)', '--ease-out': 'cubic-bezier(0.2, 0, 0, 1)', '--ease-spring': 'cubic-bezier(0.2, 0, 0, 1)',
  '--dur-1': '90ms', '--dur-2': '150ms', '--dur-3': '220ms', '--dur-4': '320ms',
 },
 light={
  '--bg': '#EFEFEF', '--bg-2': '#E6E6E6', '--surface': '#FFFFFF', '--surface-2': '#F4F4F4', '--surface-3': '#E4E4E4', '--surface-glass': '#FFFFFF',
  '--fill': '#FFFFFF', '--fill-2': '#F4F4F4',
  '--ink': '#161616', '--text': '#161616', '--muted': '#4A4A4A', '--faint': '#5C5C5C', '--line': 'rgba(0, 0, 0, 0.12)', '--border': '#C9C9C9', '--border-hover': '#9E9E9E', '--border-strong': '#7A7A7A',
  '--primary': '#1F1F1F', '--primary-hover': '#333333', '--primary-active': '#000000', '--on-primary': '#FFFFFF', '--primary-edge': '#1F1F1F',
  '--accent': '#1F1F1F', '--accent-soft': 'rgba(0, 0, 0, 0.07)', '--accent-softer': 'rgba(0, 0, 0, 0.04)', '--selected-bg': '#E6E6E6', '--selected-edge': '#1F1F1F',
  '--focus-ring': '#1F1F1F', '--selection-bg': '#CFCFCF', '--selection-ink': '#161616',
  '--side': '#1F1F1F', '--side-2': '#2A2A2A', '--side-text': '#EDEDED', '--side-strong': '#FFFFFF', '--side-dim': '#A6A6A6', '--side-active': '#3A3A3A', '--side-hover': 'rgba(255, 255, 255, 0.08)', '--side-line': 'rgba(255, 255, 255, 0.1)',
  '--inverse-bg': '#1F1F1F', '--inverse-text': '#EDEDED', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#A6A6A6', '--toast-bg': '#1F1F1F',
  '--btn-bg': 'var(--surface)', '--btn-border': 'var(--border)', '--btn-shadow': 'none', '--btn-hover-bg': 'var(--surface-2)', '--btn-hover-border': 'var(--border-hover)',
  '--field-bg': 'var(--surface)', '--field-border': 'var(--border)', '--seg-track': 'var(--surface-3)', '--seg-border': 'transparent', '--seg-on': 'var(--surface)',
  '--chip-bg': 'var(--surface)', '--chip-border': 'var(--border)', '--card-border': 'var(--border)', '--card-shadow': 'none',
  '--bar-bg': '#EFEFEF', '--bar-solid': '#EFEFEF', '--bar-border': 'var(--border)', '--sheet-bg': 'var(--surface)',
  '--shadow-xs': 'none', '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.1)', '--shadow': '0 2px 8px rgba(0, 0, 0, 0.12)', '--shadow-lg': '0 8px 28px rgba(0, 0, 0, 0.2)',
  '--aurora': 'var(--ink)', '--sky': '#E4E4E4', '--sky-ink': '#161616', '--err': '#A8242A', '--err-soft': '#FBEAEA',
 },
 dark={
  '--bg': '#121212', '--bg-2': '#181818', '--surface': '#1E1E1E', '--surface-2': '#262626', '--surface-3': '#303030', '--surface-glass': '#1E1E1E',
  '--fill': '#262626', '--fill-2': '#303030',
  '--ink': '#EDEDED', '--text': '#EDEDED', '--muted': '#BDBDBD', '--faint': '#A6A6A6', '--line': 'rgba(255, 255, 255, 0.12)', '--border': '#3A3A3A', '--border-hover': '#575757', '--border-strong': '#858585',
  '--primary': '#EDEDED', '--primary-hover': '#FFFFFF', '--primary-active': '#D6D6D6', '--on-primary': '#121212', '--primary-edge': '#EDEDED',
  '--accent': '#EDEDED', '--accent-soft': 'rgba(255, 255, 255, 0.10)', '--accent-softer': 'rgba(255, 255, 255, 0.05)', '--selected-bg': '#333333', '--selected-edge': '#EDEDED',
  '--focus-ring': '#FFFFFF', '--selection-bg': '#4D4D4D', '--selection-ink': '#FFFFFF',
  '--side': '#181818', '--side-2': '#222222', '--side-text': '#EDEDED', '--side-strong': '#FFFFFF', '--side-dim': '#A6A6A6', '--side-active': '#333333', '--side-hover': 'rgba(255, 255, 255, 0.08)', '--side-line': 'rgba(255, 255, 255, 0.1)',
  '--inverse-bg': '#1E1E1E', '--inverse-text': '#EDEDED', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#A6A6A6', '--toast-bg': '#333333',
  '--btn-bg': 'var(--surface)', '--btn-border': 'var(--border)', '--btn-shadow': 'none', '--btn-hover-bg': 'var(--surface-2)', '--btn-hover-border': 'var(--border-hover)',
  '--field-bg': 'var(--surface)', '--field-border': 'var(--border)', '--seg-track': 'var(--bg-2)', '--seg-border': 'transparent', '--seg-on': 'var(--surface-3)',
  '--chip-bg': 'var(--surface)', '--chip-border': 'var(--border)', '--card-border': 'var(--border)', '--card-shadow': 'none',
  '--bar-bg': '#121212', '--bar-solid': '#121212', '--bar-border': 'var(--border)', '--sheet-bg': 'var(--surface)',
  '--shadow-xs': 'none', '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.4)', '--shadow': '0 2px 10px rgba(0, 0, 0, 0.5)', '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.6)',
  '--aurora': 'var(--ink)', '--sky': '#303030', '--sky-ink': '#EDEDED',
 })

# ---------------------------------------------------------------- Paper: warm, calm, serif headings, for long reading
PAPER = derive(CLEAR,
 shared={
  '--font-display': '"Instrument Serif", "Iowan Old Style", "Charter", Georgia, serif', '--start-title-font': 'var(--font-display)', '--start-title-weight': '400', '--start-title-tracking': '-0.01em',
  '--text-3xl': '2.75rem', '--text-4xl': '3.75rem', '--text-5xl': '5rem',
  '--h1-weight': '400', '--h1-tracking': '-0.01em', '--h2-weight': '400', '--h2-tracking': '-0.005em', '--hero-weight': '400', '--hero-tracking': '-0.015em', '--body-tracking': '0', '--eyebrow-case': 'uppercase', '--eyebrow-tracking': '0.12em', '--eyebrow-weight': '600',
  '--accent-font': 'inherit', '--accent-style': 'italic', '--accent-weight': '400', '--accent-color': 'inherit', '--accent-tracking': 'inherit',
  '--r-sm': '8px', '--r-md': '12px', '--r-lg': '16px', '--r-xl': '22px', '--btn-radius': '999px', '--field-radius': '8px', '--seg-radius': '10px', '--seg-inner-radius': '8px', '--card-radius': '16px', '--sheet-radius': '22px',
  '--bar-filter': 'saturate(1.2) blur(16px)', '--sheet-filter': 'none',
  '--dur-1': '160ms', '--dur-2': '280ms', '--dur-3': '380ms',
 },
 light={
  '--bg': '#F6F1E7', '--bg-2': '#EEE7D9', '--surface': '#FFFCF6', '--surface-2': '#F3ECDF', '--surface-3': '#E8DFCE', '--surface-glass': 'rgba(255, 252, 246, 0.82)',
  '--fill': 'rgba(120, 90, 50, 0.10)', '--fill-2': 'rgba(120, 90, 50, 0.16)',
  '--ink': '#2A2520', '--text': '#2A2520', '--muted': '#5C5247', '--faint': '#665B4F', '--line': 'rgba(70, 50, 25, 0.13)', '--border': '#DED3C0', '--border-hover': '#C4B59C', '--border-strong': '#8C7D66',
  '--primary': '#2F5A87', '--primary-hover': '#284F78', '--primary-active': '#20436A', '--on-primary': '#FFFFFF', '--primary-edge': '#2F5A87',
  '--accent': '#2B5380', '--accent-soft': 'rgba(47, 90, 135, 0.10)', '--accent-softer': 'rgba(47, 90, 135, 0.06)', '--selected-bg': '#E7EBEC', '--selected-edge': '#2F5A87',
  '--focus-ring': '#2F5A87', '--selection-bg': '#F2DDB2', '--selection-ink': '#2A2520',
  '--side': '#EFE8DA', '--side-2': '#E7DECD', '--side-text': '#2A2520', '--side-strong': '#1A1611', '--side-dim': '#5C5247', '--side-active': 'rgba(120, 90, 50, 0.14)', '--side-hover': 'rgba(120, 90, 50, 0.10)', '--side-line': 'rgba(70, 50, 25, 0.13)',
  '--inverse-bg': '#2A2520', '--inverse-text': '#F6F1E7', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#C9BEAE', '--toast-bg': 'rgba(42, 37, 32, 0.94)',
  '--btn-bg': 'var(--surface)', '--btn-border': 'var(--border)', '--btn-shadow': 'none', '--btn-hover-bg': 'var(--surface-2)', '--btn-hover-border': 'var(--border-hover)',
  '--field-bg': 'var(--surface)', '--field-border': 'var(--border)', '--seg-track': 'var(--fill)', '--seg-border': 'transparent', '--seg-on': 'var(--surface)',
  '--chip-bg': 'var(--surface)', '--chip-border': 'var(--border)', '--card-border': 'var(--line)', '--card-shadow': 'none',
  '--bar-bg': 'rgba(246, 241, 231, 0.8)', '--bar-solid': '#F6F1E7', '--bar-border': 'var(--line)', '--sheet-bg': 'var(--surface)',
  '--shadow-xs': '0 1px 2px rgba(60, 40, 15, 0.05)', '--shadow-sm': '0 2px 8px rgba(60, 40, 15, 0.07)', '--shadow': '0 6px 24px rgba(60, 40, 15, 0.09)', '--shadow-lg': '0 18px 56px rgba(60, 40, 15, 0.16)',
  '--aurora': 'var(--accent)', '--sky': 'rgba(47, 90, 135, 0.10)', '--sky-ink': '#20436A', '--err': '#A8242A', '--err-soft': '#FBEAEA',
 },
 dark={
  '--bg': '#1A1714', '--bg-2': '#211D19', '--surface': '#24201C', '--surface-2': '#2D2924', '--surface-3': '#38332D', '--surface-glass': 'rgba(36, 32, 28, 0.82)',
  '--fill': 'rgba(237, 230, 218, 0.08)', '--fill-2': 'rgba(237, 230, 218, 0.14)',
  '--ink': '#EDE6DA', '--text': '#EDE6DA', '--muted': '#C8BDAB', '--faint': '#B3A794', '--line': 'rgba(237, 230, 218, 0.12)', '--border': '#3E3831', '--border-hover': '#575047', '--border-strong': '#8C8274',
  '--primary': '#2F5A87', '--primary-hover': '#386799', '--primary-active': '#284F78', '--on-primary': '#FFFFFF', '--primary-edge': '#5C86B3',
  '--accent': '#A3C0E0', '--accent-soft': 'rgba(163, 192, 224, 0.14)', '--accent-softer': 'rgba(163, 192, 224, 0.08)', '--selected-bg': '#38393A', '--selected-edge': '#A3C0E0',
  '--focus-ring': '#A3C0E0', '--selection-bg': '#5A4A2E', '--selection-ink': '#FFFFFF',
  '--side': '#211D19', '--side-2': '#2A2520', '--side-text': '#EDE6DA', '--side-strong': '#FFFFFF', '--side-dim': '#B3A794', '--side-active': 'rgba(237, 230, 218, 0.12)', '--side-hover': 'rgba(237, 230, 218, 0.08)', '--side-line': 'rgba(237, 230, 218, 0.1)',
  '--inverse-bg': '#24201C', '--inverse-text': '#EDE6DA', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#B3A794', '--toast-bg': 'rgba(56, 51, 45, 0.96)',
  '--btn-bg': 'var(--surface)', '--btn-border': 'var(--border)', '--btn-shadow': 'none', '--btn-hover-bg': 'var(--surface-2)', '--btn-hover-border': 'var(--border-hover)',
  '--field-bg': 'var(--surface)', '--field-border': 'var(--border)', '--seg-track': 'var(--fill)', '--seg-border': 'transparent', '--seg-on': 'var(--surface-3)',
  '--chip-bg': 'var(--surface)', '--chip-border': 'var(--border)', '--card-border': 'var(--line)', '--card-shadow': 'none',
  '--bar-bg': 'rgba(26, 23, 20, 0.8)', '--bar-solid': '#1A1714', '--bar-border': 'var(--line)', '--sheet-bg': 'var(--surface)',
  '--shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.35)', '--shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.4)', '--shadow': '0 8px 28px rgba(0, 0, 0, 0.5)', '--shadow-lg': '0 18px 56px rgba(0, 0, 0, 0.6)',
  '--aurora': 'var(--accent)', '--sky': 'rgba(163, 192, 224, 0.14)', '--sky-ink': '#D3E1F0',
 })

# ---------------------------------------------------------------- Contrast: accessibility first
CONTRAST = derive(CLEAR,
 shared={
  '--root-size': '112.5%', '--target': '48px', '--focus-w': '3px', '--hair-w': '1px',
  '--h1-weight': '800', '--h2-weight': '750', '--h3-weight': '700', '--hero-weight': '800', '--hero-tracking': '-0.02em', '--body-tracking': '0', '--eyebrow-case': 'uppercase', '--eyebrow-tracking': '0.08em', '--eyebrow-weight': '800',
  '--accent-color': 'inherit', '--btn-weight': '700',
  '--bar-filter': 'none', '--sheet-filter': 'none',
  '--r-md': '10px', '--r-lg': '14px', '--r-xl': '18px', '--card-radius': '14px', '--sheet-radius': '18px', '--seg-radius': '10px', '--seg-inner-radius': '8px',
 },
 light={
  '--bg': '#FFFFFF', '--bg-2': '#EBEBEB', '--surface': '#FFFFFF', '--surface-2': '#F0F0F0', '--surface-3': '#DDDDDD', '--surface-glass': '#FFFFFF',
  '--fill': '#FFFFFF', '--fill-2': '#EBEBEB',
  '--ink': '#000000', '--text': '#000000', '--muted': '#1F1F1F', '--faint': '#333333', '--line': 'rgba(0, 0, 0, 0.55)', '--border': '#000000', '--border-hover': '#000000', '--border-strong': '#000000',
  '--primary': '#0035A8', '--primary-hover': '#002A88', '--primary-active': '#001F66', '--on-primary': '#FFFFFF', '--primary-edge': '#0035A8',
  '--accent': '#0035A8', '--accent-soft': 'rgba(0, 53, 168, 0.12)', '--accent-softer': 'rgba(0, 53, 168, 0.06)', '--selected-bg': '#DCE6FF', '--selected-edge': '#0035A8',
  '--focus-ring': '#0035A8', '--selection-bg': '#0035A8', '--selection-ink': '#FFFFFF',
  '--side': '#000000', '--side-2': '#1A1A1A', '--side-text': '#FFFFFF', '--side-strong': '#FFFFFF', '--side-dim': '#E0E0E0', '--side-active': '#333333', '--side-hover': 'rgba(255, 255, 255, 0.16)', '--side-line': 'rgba(255, 255, 255, 0.5)',
  '--inverse-bg': '#000000', '--inverse-text': '#FFFFFF', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#E0E0E0', '--toast-bg': '#000000',
  '--btn-bg': 'var(--surface)', '--btn-border': '#000000', '--btn-shadow': 'none', '--btn-hover-bg': 'var(--surface-2)', '--btn-hover-border': '#000000',
  '--field-bg': '#FFFFFF', '--field-border': '#000000', '--seg-track': '#FFFFFF', '--seg-border': '#000000', '--seg-on': '#000000',
  '--chip-bg': '#FFFFFF', '--chip-border': '#000000', '--card-border': '#000000', '--card-shadow': 'none',
  '--bar-bg': '#FFFFFF', '--bar-solid': '#FFFFFF', '--bar-border': '#000000', '--sheet-bg': '#FFFFFF',
  '--shadow-xs': 'none', '--shadow-sm': 'none', '--shadow': '0 0 0 2px #000000', '--shadow-lg': '0 0 0 2px #000000',
  '--ok': '#005C2E', '--warn': '#5C3D00', '--err': '#A0001A', '--private': '#005C2E',
  '--aurora': 'var(--accent)', '--sky': '#DCE6FF', '--sky-ink': '#001F66',
 },
 dark={
  '--bg': '#000000', '--bg-2': '#141414', '--surface': '#000000', '--surface-2': '#1A1A1A', '--surface-3': '#2A2A2A', '--surface-glass': '#000000',
  '--fill': '#000000', '--fill-2': '#1A1A1A',
  '--ink': '#FFFFFF', '--text': '#FFFFFF', '--muted': '#F0F0F0', '--faint': '#DADADA', '--line': 'rgba(255, 255, 255, 0.6)', '--border': '#FFFFFF', '--border-hover': '#FFFFFF', '--border-strong': '#FFFFFF',
  '--primary': '#8AB4FF', '--primary-hover': '#A8C7FF', '--primary-active': '#6E9EF0', '--on-primary': '#000000', '--primary-edge': '#8AB4FF',
  '--accent': '#8AB4FF', '--accent-soft': 'rgba(138, 180, 255, 0.2)', '--accent-softer': 'rgba(138, 180, 255, 0.1)', '--selected-bg': '#0F2A5C', '--selected-edge': '#8AB4FF',
  '--focus-ring': '#FFE14D', '--selection-bg': '#FFE14D', '--selection-ink': '#000000',
  '--side': '#000000', '--side-2': '#1A1A1A', '--side-text': '#FFFFFF', '--side-strong': '#FFFFFF', '--side-dim': '#E0E0E0', '--side-active': '#333333', '--side-hover': 'rgba(255, 255, 255, 0.16)', '--side-line': 'rgba(255, 255, 255, 0.6)',
  '--inverse-bg': '#000000', '--inverse-text': '#FFFFFF', '--inverse-strong': '#FFFFFF', '--inverse-dim': '#E0E0E0', '--toast-bg': '#000000',
  '--btn-bg': '#000000', '--btn-border': '#FFFFFF', '--btn-shadow': 'none', '--btn-hover-bg': '#1A1A1A', '--btn-hover-border': '#FFFFFF',
  '--field-bg': '#000000', '--field-border': '#FFFFFF', '--seg-track': '#000000', '--seg-border': '#FFFFFF', '--seg-on': '#FFFFFF',
  '--chip-bg': '#000000', '--chip-border': '#FFFFFF', '--card-border': '#FFFFFF', '--card-shadow': 'none',
  '--bar-bg': '#000000', '--bar-solid': '#000000', '--bar-border': '#FFFFFF', '--sheet-bg': '#000000',
  '--shadow-xs': 'none', '--shadow-sm': 'none', '--shadow': '0 0 0 2px #FFFFFF', '--shadow-lg': '0 0 0 2px #FFFFFF',
  '--ok': '#7DE2A6', '--warn': '#FFD27A', '--err': '#FF9C95', '--private': '#7DE2A6',
  '--aurora': 'var(--accent)', '--sky': '#0F2A5C', '--sky-ink': '#FFFFFF',
 })
# Contrast: the selected segment is ink-filled, so its label must flip
CONTRAST['light']['--seg-on-ink'] = '#FFFFFF'; CONTRAST['dark']['--seg-on-ink'] = '#000000'
for t in (LAPIS, CLEAR, GRAPHITE, PAPER):
    t['light'].setdefault('--seg-on-ink', 'var(--ink)'); t['dark'].setdefault('--seg-on-ink', 'var(--ink)')

LAPIS['light'].update({'--side-accent': '#ADC6FF', '--side-accent-icon': '#81A6FE'}); LAPIS['dark'].update({'--side-accent': '#ADC6FF', '--side-accent-icon': '#81A6FE'})
CLEAR['light'].update({'--side-accent': 'var(--primary)', '--side-accent-icon': 'var(--primary)'}); CLEAR['dark'].update({'--side-accent': '#61A2FD', '--side-accent-icon': '#61A2FD'})
GRAPHITE['light'].update({'--side-accent': '#FFFFFF', '--side-accent-icon': '#FFFFFF'}); GRAPHITE['dark'].update({'--side-accent': '#FFFFFF', '--side-accent-icon': '#FFFFFF'})
PAPER['light'].update({'--side-accent': 'var(--accent)', '--side-accent-icon': 'var(--accent)'}); PAPER['dark'].update({'--side-accent': '#A3C0E0', '--side-accent-icon': '#A3C0E0'})
CONTRAST['light'].update({'--side-accent': '#8AB4FF', '--side-accent-icon': '#8AB4FF'}); CONTRAST['dark'].update({'--side-accent': '#8AB4FF', '--side-accent-icon': '#8AB4FF'})
for _t, _l, _d in [(LAPIS, ('linear-gradient(180deg, rgba(88, 132, 248, 0.32), rgba(46, 81, 182, 0.22))', 'rgba(129, 166, 254, 0.4)', 'var(--side-strong)'), None),
                   (CLEAR, ('var(--selected-bg)', 'transparent', 'var(--side-accent)'), None), (GRAPHITE, ('var(--side-active)', 'transparent', '#FFFFFF'), None),
                   (PAPER, ('var(--selected-bg)', 'transparent', 'var(--side-accent)'), None), (CONTRAST, ('var(--side-active)', '#8AB4FF', '#FFFFFF'), None)]:
    for _m in ('light', 'dark'):
        _t[_m].update({'--side-selected': _l[0], '--side-selected-edge': _l[1], '--side-selected-ink': _l[2]})
LAPIS['shared'].update({'--thumb': '18px', '--thumb-shadow': '0 0 0 1px rgba(21, 21, 21, 0.12), 0 2px 6px rgba(21, 21, 21, 0.25)', '--pop-radius': '16px'})
for _m in ('light', 'dark'): LAPIS[_m].update({'--pop-bg': 'var(--surface)', '--pop-border': 'var(--border)'})
for _t in (CLEAR, PAPER): _t['shared'].update({'--thumb': '24px', '--thumb-shadow': '0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 3px 8px rgba(0, 0, 0, 0.18), 0 1px 1px rgba(0, 0, 0, 0.1)', '--pop-radius': '14px'})
GRAPHITE['shared'].update({'--thumb': '16px', '--thumb-shadow': '0 0 0 1px rgba(0, 0, 0, 0.35)', '--pop-radius': '8px'})
CONTRAST['shared'].update({'--thumb': '26px', '--thumb-shadow': '0 0 0 2px #000000', '--pop-radius': '12px'})
for _t in (CLEAR, PAPER):
    _t['light'].update({'--pop-bg': 'var(--sheet-bg)', '--pop-border': 'var(--line)'}); _t['dark'].update({'--pop-bg': 'var(--sheet-bg)', '--pop-border': 'var(--line)'})
for _t in (GRAPHITE, CONTRAST):
    _t['light'].update({'--pop-bg': 'var(--surface)', '--pop-border': 'var(--border)'}); _t['dark'].update({'--pop-bg': 'var(--surface)', '--pop-border': 'var(--border)'})
GRAPHITE['light'].update({'--side': '#F7F7F7', '--side-2': '#EDEDED', '--side-text': '#161616', '--side-strong': '#000000', '--side-dim': '#4A4A4A', '--side-active': 'rgba(0, 0, 0, 0.08)', '--side-hover': 'rgba(0, 0, 0, 0.06)', '--side-line': 'rgba(0, 0, 0, 0.12)', '--side-accent': '#000000', '--side-accent-icon': '#000000', '--side-selected': 'rgba(0, 0, 0, 0.08)', '--side-selected-edge': 'transparent', '--side-selected-ink': '#000000'})
CONTRAST['light'].update({'--side': '#FFFFFF', '--side-2': '#F0F0F0', '--side-text': '#000000', '--side-strong': '#000000', '--side-dim': '#1F1F1F', '--side-active': '#DCE6FF', '--side-hover': 'rgba(0, 0, 0, 0.08)', '--side-line': '#000000', '--side-accent': '#0035A8', '--side-accent-icon': '#0035A8', '--side-selected': '#DCE6FF', '--side-selected-edge': '#0035A8', '--side-selected-ink': '#0035A8'})
# Grouped (inset) lists: settings, storage, downloads, install chooser
for _m in ('light', 'dark'):
    LAPIS[_m].update({'--group-bg': 'var(--surface)', '--list-bg': 'transparent', '--list-border': 'var(--line)', '--list-pad': '0px', '--list-last-line': 'var(--line)'})
    for _t in (CLEAR, PAPER):
        _t[_m].update({'--group-bg': 'var(--bg)', '--list-bg': 'var(--surface)', '--list-border': 'transparent', '--list-pad': '16px', '--list-last-line': 'transparent'})
    for _t in (GRAPHITE, CONTRAST):
        _t[_m].update({'--group-bg': 'var(--surface)', '--list-bg': 'var(--surface)', '--list-border': 'var(--border)', '--list-pad': '14px', '--list-last-line': 'transparent'})
LAPIS['shared'].update({'--list-radius': '16px', '--card-radius-sm': '10px', '--list-frame': 'transparent'})
for _t in (CLEAR, PAPER): _t['shared']['--list-frame'] = 'transparent'
for _t in (GRAPHITE, CONTRAST): _t['shared']['--list-frame'] = 'var(--border)'
CLEAR['shared'].update({'--list-radius': '12px', '--card-radius-sm': '12px'}); PAPER['shared'].update({'--list-radius': '12px', '--card-radius-sm': '12px'})
GRAPHITE['shared'].update({'--list-radius': '6px', '--card-radius-sm': '6px'}); CONTRAST['shared'].update({'--list-radius': '10px', '--card-radius-sm': '10px'})
THEMES = [('clear', 'Clear', CLEAR), ('lapis', 'Lapis', LAPIS), ('graphite', 'Graphite', GRAPHITE), ('paper', 'Paper', PAPER), ('contrast', 'Contrast', CONTRAST)]

def block(sel, d, extra=''):
    return sel + ' {\n' + ''.join('  %s: %s;\n' % (k, v) for k, v in d.items()) + extra + '}\n'

out = ['/* THEMES:BEGIN — generated from the theme table (see docs/DESIGN.md, "Themes"). A theme is a token set only.\n   Clear is the default (no attribute). Every other theme is html[data-skin="<id>"], orthogonal to data-theme (light/dark). */\n']
for tid, name, t in THEMES:
    keys_l, keys_d = set(t['light']), set(t['dark'])
    assert keys_l == keys_d, (tid, keys_l ^ keys_d)
    if tid == 'clear':
        out.append(block(':root, [data-skin-preview="clear"]', {**t['shared'], **t['light']}, '  color-scheme: light;\n'))
        out.append(block(':root[data-theme="dark"], :root[data-theme="dark"] [data-skin-preview="clear"]', t['dark'], '  color-scheme: dark;\n'))
    else:
        out.append('/* ' + name + ' */\n')
        out.append(block(':root[data-skin="%s"], [data-skin-preview="%s"]' % (tid, tid), {**t['shared'], **t['light']}))
        out.append(block(':root[data-skin="%s"][data-theme="dark"], :root[data-theme="dark"] [data-skin-preview="%s"]' % (tid, tid), t['dark']))
out.append(':root[data-theme="dark"]:not([data-surround]) { --stage: var(--surround-dark); --stage-ink: #A3A3A3; }\n/* THEMES:END */\n')
css = ''.join(out)

f = 'assets/css/app.css'; s = open(f).read()
if '/* THEMES:BEGIN' in s:
    a = s.index('/* THEMES:BEGIN'); b = s.index('/* THEMES:END */\n') + len('/* THEMES:END */\n')
    s = s[:a] + css + s[b:]
else:
    # first run: strip the per-theme tokens from :root, drop the old dark and contrast blocks, insert the generated table
    root_a = s.index(':root {'); root_b = s.index('\n}\n', root_a)
    root = s[root_a:root_b]
    moved = set()
    for tid, name, t in THEMES:
        moved |= set(t['shared']) | set(t['light'])
    keep = []
    for line in root.split('\n'):
        m = re.match(r'\s*(--[\w-]+):', line)
        if m and m.group(1) in moved: continue
        if line.strip() == 'color-scheme: light;': continue
        keep.append(line)
    s = s[:root_a] + '\n'.join(keep) + s[root_b:]
    a = s.index(':root[data-theme="dark"] {'); b = s.index('  color-scheme: dark;\n}\n', a) + len('  color-scheme: dark;\n}\n')
    s = s[:a] + css + s[b:]
    a = s.index('/* More contrast when the person asks for it. */'); b = s.index('/* ====', a)
    s = s[:a] + '''/* More contrast when the person asks for it (Clear only; the Contrast theme is the full answer and is suggested, not forced). */
@media (prefers-contrast: more) {
  :root:not([data-skin]) { --muted: #3A3A3C; --faint: #48484A; --line: rgba(0, 0, 0, 0.3); --border: #8E8E93; --primary: #0356B4; --accent: #0356B4; }
  :root:not([data-skin])[data-theme="dark"] { --muted: #E5E5EA; --faint: #D1D1D6; --line: rgba(255, 255, 255, 0.4); --border: #8E8E93; --accent: #8AB4FF; }
}
''' + s[b:]
open(f, 'w').write(s)
print('ok', len(css))
