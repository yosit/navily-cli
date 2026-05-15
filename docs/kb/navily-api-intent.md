---
title: Navily API Intent — screen/intent/trigger per endpoint
tags: [navily, api, intent, ux]
---

# Navily API Intent

What each endpoint *does for the user*, when the UI calls it, and what trigger initiates it.

## Identity

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/ajax/get-session-data` | Header / any logged-in page | Render "Hi, {name}" + avatar, decide whether to show Login or My Account | Page load |
| GET `/users/me` (proxy) | Account settings, profile | Hydrate profile editor: language, currency, units, identity, boat | Open account page |
| GET `/users/{id}` (proxy) | Public user profile, comment authors | Show public profile card | Click a user's name on a review/list |

## Discovery (search & map)

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/api/search?q=` | Header search box | Quick autocomplete across regions/marinas/anchorages | Typing in the search input (debounced) |
| GET `/api/map-search` | Map screen (`/carte`) | Repopulate the map markers within the current viewport | Map pan/zoom idle event |
| GET `/api/map-search/price?id=` | Map screen | Show "tonight from €X" badge on a marina marker | Marker render if marina is bookable |
| GET `/search/places` (proxy) | Full search page | Hybrid search incl. users + shops + regions | User submits search |
| GET `/search/standard-boats` (proxy) | Boat picker (in profile / booking) | Find a stock boat model | Typing in the boat search box |

## Marina / port detail

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/api/ports/get-with-media?id=` | Marina detail page | Full SSR/hydrate of marina (header, gallery, equipments, hours, visits) | Page load `/port/{slug}/{id}` |
| GET `/ports/{id}` (proxy) | Marina detail (Vue SPA) | Same as above, called by SPA after navigation | Client-side route change |
| GET `/ports/{id}/comment` | Marina detail | Show "your review" panel (or "leave a review" CTA) | Page load |
| GET `/ports/{id}/comments` | Reviews tab | Paginated reviews with translations | Open Reviews tab / scroll for more |
| GET `/ports/{id}/photos` | Photos tab | Photo gallery | Open Photos tab |
| GET `/ports/{id}/equipments` | Services tab | List water/electricity/etc. with availability + cost | Open Services tab |
| GET `/ports/{id}/weather` | Weather tab | 33-entry forecast for arrival planning | Open Weather tab |
| GET `/ports/{id}/shops` | Shops tab | Nearby restaurants/services with category filter | Open Shops tab |
| GET `/ports/{id}/bookable-around-ports` | Below the fold on detail page | "Alternative marinas nearby" carousel | Page load (after detail) |
| GET `/ports/{id}/hashed` | Guest booking flow | Public marina info via hash (no login) | Open marina from a hashed booking link |
| POST `/ports/{id}/discover` | "I've been here" button | Mark marina as visited (contributor score) | Click "I've been here" |
| POST `/ports/{id}/comments/create` | Review form | Submit new review | Click "Send review" |
| POST `/ports/comments/{id}/update` | Review form (edit mode) | Edit your existing review | Click "Save" after editing review |

## Anchorage / mooring detail

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/moorings/{id}` (proxy) | Anchorage detail | Full hydrate of an anchorage | Page load `/mouillage/{slug}/{id}` |
| GET `/moorings/{id}/comments` | Reviews tab | Paginated reviews | Open Reviews tab |
| GET `/moorings/{id}/photos` | Photos tab | Photo gallery | Open Photos tab |
| GET `/moorings/{id}/weather` | Weather tab | Forecast with wind/wave protection scores ("good to anchor?") | Open Weather tab |
| GET `/moorings/{id}/shops` | Shops tab | Nearby shops | Open Shops tab |

## Region

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/regions` (proxy) | (Internal — global region picker) | Paginated index | Admin/SEO crawler |
| GET `/regions/{id}` (proxy) | Region landing page | Country/coordinate, breadcrumbs | Page load `/region/{slug}/{id}` |
| GET `/regions/{id}/ports` | Region page | Paginated list of marinas in this region | Open "Marinas" tab |
| GET `/regions/{id}/moorings` | Region page | Paginated list of anchorages | Open "Anchorages" tab |

## Personal (account)

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/boats` (proxy) | My Boats page | List the user's boats | Open My Boats |
| GET `/lists` (proxy) | My Favourites page | List of the user's lists | Open Favourites |
| GET `/lists/{id}/entries` (proxy) | A list page | Places saved in this list | Click a list |
| GET `/lists/{id}/comments` (proxy) | A list page | Comments on this shared list | Open comments tab |
| GET `/cards` (proxy) | Billing / payment methods | Show saved cards | Open Billing |
| GET `/notifications` (proxy) | Notifications bell | Recent notifications | Open notifications dropdown |
| GET `/notifications/count` (proxy) | Header bell badge | Show unread badge | Page load, periodic poll |
| GET `/user-subscriptions/last` (proxy) | Settings → Premium | Show current subscription state | Open Premium tab |

## Bookings (demands)

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/demands` (proxy) | My Bookings | All booking demands | Open My Bookings |
| GET `/demands/infos` (proxy) | Header bell or dashboard | Quick summary (any active? any unconfirmed offer?) | Page load |
| GET `/demands/offers` (proxy) | Offers banner | "You have N offers awaiting" | Page load when offers exist |
| GET `/demands/{id}/messages` (proxy) | Chat thread | Conversation with the marina | Open a booking |
| POST `/demands/{id}/send` (proxy) | Booking confirmation | Submit the booking request | Click "Send booking" |
| POST `/demands/{id}/confirm` (proxy) | Offer details modal | Confirm an offer | Click "Accept offer" |
| POST `/demands/{id}/cancel` (proxy) | Booking detail | Cancel | Click "Cancel" |
| POST `/demands/{id}/check-in-time` (proxy) | Booking detail | Update ETA | Adjust check-in time picker |

`/resalib/demands/{id}/hashed/...` mirrors the above for the **guest** (non-logged-in) hashed booking link (e.g. when a marina invites you via SMS).

## Subscriptions / payments

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/user-subscriptions/promotion-code/check` (proxy) | Checkout | Validate a promo code | Apply promo button |
| GET `/user-subscriptions/stripe/navily-premium` (proxy) | Checkout | Stripe setup | Page load |
| POST `/user-subscriptions/create/premium-yearly/web` (proxy) | Checkout | Subscribe (annual) | Submit checkout |
| POST `/user-subscriptions/payment-intent` (proxy) | Checkout | Create payment intent | Card entry |
| POST `/user-subscriptions/{id}/cancel/web` (proxy) | Settings → Premium | Cancel auto-renewal | Click cancel |
| POST `/user-subscriptions/{id}/active-renewal/web` (proxy) | Settings → Premium | Re-enable | Click re-activate |
| GET `/cards/sca/setup-intent` (proxy) | Card form | Stripe SCA setup intent | Card form mount |
| POST `/cards/sca/create` (proxy) | Card form | Save card | Submit |
| POST `/cards/{id}/remove` (proxy) | Card list | Remove a card | Click trash |

## OTP & onboarding

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| POST `/otp/email/create` (proxy) | Signup / 2FA | Send email OTP | Click "Send code" |
| POST `/otp/email/check` (proxy) | Signup / 2FA | Verify OTP code | Submit code |
| POST `/otp/phone/create` (proxy) | Signup / 2FA | Send SMS OTP | Click "Send code" |
| POST `/otp/phone/check` (proxy) | Signup / 2FA | Verify SMS code | Submit code |
| POST `/users/check-email` (proxy) | Signup | Email already taken? | Email field blur |
| POST `/users/check-password` (proxy) | Sensitive flows | Confirm password | Submit |
| POST `/users/forgotten` (proxy) | Password reset | Send reset email | Submit email |
| POST `/users/register-with-otp` (proxy) | Signup | Create account | Submit signup form |
| POST `/users/validated-email` (proxy) | Verify-email page | Confirm token | Open email link |

## Misc

| Endpoint | Screen | Intent | Trigger |
|----------|--------|--------|---------|
| GET `/misc/countries` (proxy) | Country picker (signup, boat reg, identity) | List of all countries with calling codes, flags, VHF emergency channels | Field focus |
| GET `/api/markdown-to-html?text=` | Review editor preview | Render the user's markdown live | Typing in the editor (debounced) |
| POST `/api/proxy` | (gateway) | Forward an authenticated request to api.navily.com | Every Vue/axios call |
| POST `/logs/action` (proxy) | (background) | Client-side analytics events | Various |

## Enum reference

### kind / type
- `kind`: `port`, `mooring`, `region`, `user`, `shop`
- Port `type`: `aflot` (observed)
- Mooring `type`: `anchor` (observed)
- Plan: `basic` (free), `master` (premium marina)

### Mooring protections / seabeds
- Protections: `n, ne, e, se, s, sw, w, nw` (16-pt compass not yet seen)
- Seabeds: `sand, rock, algae, mud, weed, shells, gravel`

### Equipment keys
`electricity, water, shower, wc, fuel, used_water, wifi, launching_ramp, recycling, bike, car_rental, camera, night_watchman, launderette, ice, shipchandler, customs_clearance, crane`

### Permissions (0/1)
On a port: `demand, addPhoto, info, list, like, report, comment, book`. `1 = allowed`.

### Languages (configuration.language)
`en, fr, es, it, de` (observed in `region.name` and `slugs` maps).
