import { ChevronDown } from 'lucide-react'

export default function Select({ value, onChange, options, label }) {
  return (
    <div className="select">
      <label className="sr-only" htmlFor={`select-${label}`}>{label}</label>
      <select
        id={`select-${label}`}
        className="select-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {/* A PLAIN STRING IS ITS OWN LABEL, which is what every caller passed until the
            timetable grid needed to show a teacher's NAME while sending their id. An object
            option carries the two separately; strings keep working untouched. */}
        {options.map((o) => {
          const value = typeof o === 'string' ? o : o.value
          const label = typeof o === 'string' ? o : o.label
          return <option key={value} value={value}>{label}</option>
        })}
      </select>
      <ChevronDown size={15} className="select-caret" aria-hidden="true" />
    </div>
  )
}
