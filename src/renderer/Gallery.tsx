import { Button, type ButtonVariant } from './components/Button';
import { Chip, type ChipTone } from './components/Chip';
import { tokens } from '../shared/tokens';
import './Gallery.css';

// Shown on #gallery: under `pnpm dev`, or when main is started with HARNESS_GALLERY=1.
// It lets every Button and Chip variant be checked by eye and by the e2e tests.

const BUTTON_VARIANTS: { variant: ButtonVariant; label: string }[] = [
  { variant: 'primary', label: 'Primary' },
  { variant: 'gate', label: 'Gate' },
  { variant: 'secondary', label: 'Secondary' },
  { variant: 'ghost', label: 'Ghost' },
  { variant: 'danger', label: 'Danger' },
];

const CHIP_TONES: { tone: ChipTone; label: string }[] = [
  { tone: 'neutral', label: 'Neutral' },
  { tone: 'accent', label: 'Accent' },
  { tone: 'amber', label: 'Amber' },
  { tone: 'green', label: 'Green' },
  { tone: 'red', label: 'Red' },
];

const INTER_WEIGHTS: { label: string; weight: number }[] = [
  { label: 'Inter Regular 400', weight: tokens.weight.regular },
  { label: 'Inter Medium 500', weight: tokens.weight.medium },
  { label: 'Inter Semibold 600', weight: tokens.weight.semibold },
  { label: 'Inter Bold 700', weight: tokens.weight.bold },
];

const MONO_WEIGHTS: { label: string; weight: number }[] = [
  { label: 'JetBrains Mono Regular 400', weight: tokens.weight.regular },
  { label: 'JetBrains Mono Medium 500', weight: tokens.weight.medium },
];

const noop = () => undefined;

export function Gallery() {
  return (
    <main className="gallery">
      <h1 className="gallery__title">Design tokens gallery</h1>

      <section className="gallery__section" aria-labelledby="gallery-buttons">
        <h2 id="gallery-buttons" className="gallery__heading">
          Buttons
        </h2>
        {BUTTON_VARIANTS.map(({ variant, label }) => (
          <div className="gallery__row" key={variant}>
            <span className="gallery__label">{label}</span>
            <Button variant={variant}>{label}</Button>
            <Button variant={variant} size="small">
              {`${label} small`}
            </Button>
            <Button variant={variant} disabled>
              {`${label} disabled`}
            </Button>
          </div>
        ))}
      </section>

      <section className="gallery__section" aria-labelledby="gallery-chips">
        <h2 id="gallery-chips" className="gallery__heading">
          Chips
        </h2>
        {CHIP_TONES.map(({ tone, label }) => (
          <div className="gallery__row" key={tone}>
            <span className="gallery__label">{label}</span>
            <Chip tone={tone}>{label}</Chip>
            <Chip tone={tone} onClick={noop}>
              {`${label} button`}
            </Chip>
          </div>
        ))}
      </section>

      <section className="gallery__section" aria-labelledby="gallery-type">
        <h2 id="gallery-type" className="gallery__heading">
          Type
        </h2>
        {INTER_WEIGHTS.map(({ label, weight }) => (
          <p key={label} className="gallery__sample" style={{ fontWeight: weight }}>
            {label}: The quick brown fox jumps over the lazy dog.
          </p>
        ))}
        {MONO_WEIGHTS.map(({ label, weight }) => (
          <p
            key={label}
            className="gallery__sample gallery__sample--mono"
            style={{ fontWeight: weight }}
          >
            {label}: const workspace = &apos;SDD Harness&apos;;
          </p>
        ))}
      </section>
    </main>
  );
}
