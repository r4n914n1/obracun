import {
  MONTHLY_PLANS,
  QUARTERLY_PLANS,
  TRIAL_CALCULATIONS,
  type PricingPlan,
} from '../data/pricingPlans'
import { openBugReportMail } from '../services/bugReport'
import { APP_DISCLAIMER } from '../data/disclaimer'

interface PricingPageProps {
  onBack: () => void
  showLoginHint?: boolean
}

function formatLimit(n: number): string {
  return n.toLocaleString('sr-RS')
}

function PlanCard({ plan }: { plan: PricingPlan }) {
  return (
    <article className={`pricing-card${plan.featured ? ' is-featured' : ''}`}>
      {plan.featured ? <span className="pricing-badge">Preporučeno</span> : null}
      <h3 className="pricing-card-name">{plan.name}</h3>
      <p className="pricing-card-blurb">{plan.blurb}</p>
      <p className="pricing-card-price">
        <strong>{plan.priceEur} €</strong>
        <span> / {plan.periodLabel}</span>
      </p>
      {plan.compareAtEur != null && plan.savingsEur != null ? (
        <p className="pricing-card-save">
          umesto {plan.compareAtEur} € · ušteda {plan.savingsEur} €
        </p>
      ) : (
        <p className="pricing-card-save pricing-card-save-spacer">&nbsp;</p>
      )}
      <p className="pricing-card-limit">
        Do <strong>{formatLimit(plan.monthlyLimit)}</strong> računanja{' '}
        <em>mesečno</em>
      </p>
      <button type="button" className="btn btn-secondary pricing-card-cta" disabled>
        Uskoro — online plaćanje
      </button>
    </article>
  )
}

export function PricingPage({ onBack, showLoginHint = false }: PricingPageProps) {
  return (
    <div className="pricing-page">
      <header className="pricing-top">
        <div className="pricing-top-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
            {showLoginHint ? '← Nazad na prijavu' : '← Nazad na kalkulator'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => openBugReportMail()}
            title="Pošalji prijavu greške na e-mail"
          >
            Bug report
          </button>
        </div>
      </header>

      <div className="pricing-inner">
        <p className="pricing-eyebrow">Pretplata</p>
        <h1 className="pricing-title">Obračun putarine</h1>
        <p className="pricing-hero">
          {TRIAL_CALCULATIONS} besplatnih računanja. Zatim od 3 € mesečno — biraj
          paket prema tome koliko ti treba.
        </p>

        <section className="pricing-trial">
          <h2>Probaj besplatno</h2>
          <p>
            Prijavi se i dobijaš <strong>{TRIAL_CALCULATIONS} besplatnih
            računanja</strong>. Posle toga biraš paket. Jedno računanje = jedan
            uspešan IZRAČUNAJ (ruta + putarina + troškovi).
          </p>
        </section>

        <section className="pricing-section">
          <h2>Mesečni paketi</h2>
          <div className="pricing-grid">
            {MONTHLY_PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </section>

        <section className="pricing-section">
          <h2>Paketi na 3 meseca</h2>
          <p className="pricing-section-note">
            Ista <strong>mesečna</strong> kvota kao u mesečnom paketu — plaćaš
            unapred i štediš. Limit se ne sabira na 3 meseca.
          </p>
          <div className="pricing-grid">
            {QUARTERLY_PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </div>
        </section>

        <section className="pricing-faq">
          <h2>Česta pitanja</h2>
          <dl>
            <div>
              <dt>Šta ulazi u računanje?</dt>
              <dd>
                Jedan klik na IZRAČUNAJ (uključujući povratak B → A ako je
                uključen).
              </dd>
            </div>
            <div>
              <dt>Šta sa CSV-om?</dt>
              <dd>
                Učitavanje stajanja i obračun troše kvotu kao i ručni unos (1
                IZRAČUNAJ = 1 računanje).
              </dd>
            </div>
            <div>
              <dt>Šta kad potrošim limit?</dt>
              <dd>
                Računanje se privremeno blokira do sledećeg obračunskog perioda
                ili nadogradnje paketa. Mesečni limit se ne prenosi.
              </dd>
            </div>
            <div>
              <dt>Da li se 3-mesečni limit sabira?</dt>
              <dd>
                Ne. Imaš isti mesečni limit kao u odgovarajućem mesečnom paketu,
                tokom 3 meseca.
              </dd>
            </div>
            <div>
              <dt>Plaćanje i domen?</dt>
              <dd>
                Aplikacija ide na <strong>transportcost.info</strong>. Online
                plaćanje (kartica / pretplata) biće povezano kada naplata bude
                spremna — do tada paketi su prikazani radi pregleda.
              </dd>
            </div>
            <div>
              <dt>Odricanje odgovornosti</dt>
              <dd>{APP_DISCLAIMER}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  )
}
