import { useEffect, useId, useRef, useState } from 'react'
import type { Location } from '../types'
import { loadGoogleMaps } from '../services/googleMaps'
import { useLocale } from '../i18n/LocaleContext'

interface PlaceInputProps {
  label: string
  placeholder?: string
  value: Location | null
  onChange: (location: Location | null) => void
  /** Hide visible label (still used for a11y via aria-label). */
  compact?: boolean
  locked?: boolean
  onLockedInteract?: () => void
}

export function PlaceInput({
  label,
  placeholder,
  value,
  onChange,
  compact = false,
  locked = false,
  onLockedInteract,
}: PlaceInputProps) {
  const { t, locale, ready: localeReady } = useLocale()
  const resolvedPlaceholder = placeholder ?? t('placePlaceholder')
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const onChangeRef = useRef(onChange)
  const [text, setText] = useState(value?.label ?? '')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (value) setText(value.label)
  }, [value])

  useEffect(() => {
    if (!localeReady || locked) return

    let cancelled = false
    let listener: google.maps.MapsEventListener | null = null
    const mapsLang = locale === 'sr' ? 'sr' : 'en'

    loadGoogleMaps(mapsLang)
      .then(() => {
        if (cancelled || !inputRef.current || autocompleteRef.current) return

        const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address', 'geometry', 'name'],
        })

        autocompleteRef.current = autocomplete
        listener = autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace()
          const lat = place.geometry?.location?.lat()
          const lng = place.geometry?.location?.lng()

          if (lat == null || lng == null) {
            onChangeRef.current(null)
            setError(t('placePickError'))
            return
          }

          const labelText =
            place.formatted_address ?? place.name ?? inputRef.current?.value ?? ''

          setError(null)
          setText(labelText)
          onChangeRef.current({ label: labelText, lat, lng })
        })

        setReady(true)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('mapsError'))
        }
      })

    return () => {
      cancelled = true
      if (listener && window.google?.maps?.event) {
        google.maps.event.removeListener(listener)
      }
    }
    // Init once locale is known; Maps language cannot swap without full page reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localeReady, locked])

  function handleLockedInteract() {
    if (!locked) return
    onLockedInteract?.()
  }

  return (
    <label className={`field${compact ? ' field-compact' : ''}`} htmlFor={inputId}>
      {compact ? (
        <span className="visually-hidden">{label}</span>
      ) : (
        <span className="field-label">{label}</span>
      )}
      <input
        id={inputId}
        ref={inputRef}
        className={`field-input${locked ? ' field-input-locked' : ''}`}
        type="text"
        value={text}
        placeholder={
          locked
            ? t('placeLoginRequired')
            : ready
              ? resolvedPlaceholder
              : t('placesLoading')
        }
        disabled={!locked && !ready}
        readOnly={locked}
        aria-label={label}
        onChange={(event) => {
          if (locked) return
          setText(event.target.value)
          if (value) onChange(null)
          setError(null)
        }}
        onFocus={handleLockedInteract}
        onClick={handleLockedInteract}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
        autoComplete="off"
      />
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  )
}
