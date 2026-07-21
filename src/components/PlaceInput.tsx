import { useEffect, useId, useRef, useState } from 'react'
import type { Location } from '../types'
import { loadGoogleMaps } from '../services/googleMaps'

interface PlaceInputProps {
  label: string
  placeholder?: string
  value: Location | null
  onChange: (location: Location | null) => void
}

export function PlaceInput({
  label,
  placeholder = 'Unesite adresu',
  value,
  onChange,
}: PlaceInputProps) {
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
    // Sync label when a place is selected; do not wipe text when value
    // becomes null (user is editing / clearing coordinates only).
    if (value) setText(value.label)
  }, [value])

  useEffect(() => {
    let cancelled = false
    let listener: google.maps.MapsEventListener | null = null

    loadGoogleMaps()
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
            setError('Izaberite adresu iz liste predloga')
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
          setError(err instanceof Error ? err.message : 'Greška Google Maps')
        }
      })

    return () => {
      cancelled = true
      if (listener && window.google?.maps?.event) {
        google.maps.event.removeListener(listener)
      }
    }
  }, [])

  return (
    <label className="field" htmlFor={inputId}>
      <span className="field-label">{label}</span>
      <input
        id={inputId}
        ref={inputRef}
        className="field-input"
        type="text"
        value={text}
        placeholder={ready ? placeholder : 'Učitavanje Google Places...'}
        disabled={!ready}
        onChange={(event) => {
          setText(event.target.value)
          if (value) onChange(null)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
        autoComplete="off"
      />
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  )
}
