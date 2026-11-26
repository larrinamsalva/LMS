# Printable selected status breakdown — LMS #243

The selected visit review print report now contains five horizontal status bars: Scheduled, In progress, Completed, Cancelled and Other. The chart uses the same exact integer totals from the validated selected CSV as the summary, and displays counts and shares of saved appointment date overlaps rounded to one decimal percent. All bars share the same denominator. Labels and counts remain legible without color. Zero overlap totals show empty bars and an explicit no-availability warning. Rounded shares may not sum to exactly 100%.

Counts are date overlaps, not unique appointments. The existing NOT BOOKED notice, summary, selected rows and print action remain intact. No private records, names, times, booking, resource availability claim, persistence, API/schema/auth changes or other repositories are involved.

The existing desktop/tablet/phone scheduling scenario verifies selected and all-row chart values, widths, and a no-saved-records selection if present. No additional demo sessions. Full local suite not run; wait for all five final-head GitHub checks before merging. Never auto-merge.
