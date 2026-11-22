/**
 * Help Center (prompt §8/§9): getting started, privacy, terms,
 * about. All honest, all local — there is no account, no server
 * and no support desk; the "contact" route is the GitHub repo.
 */
import { Box, Card, CardContent, Link, Stack, Typography } from '@mui/material'
import { useI18n } from '../lib/use-i18n'

export function HelpPage() {
  const { t } = useI18n()
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" id="help-heading">
          {t('help.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          {t('help.intro')}
        </Typography>
      </Box>

      <Card component="section" aria-labelledby="help-start-heading">
        <CardContent>
          <Typography variant="h6" component="h3" id="help-start-heading">
            {t('help.start')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('help.startP1')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('help.startP2')}
          </Typography>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="help-privacy-heading">
        <CardContent>
          <Typography variant="h6" component="h3" id="help-privacy-heading">
            {t('help.privacy')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('help.privacyP')}
          </Typography>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="help-terms-heading">
        <CardContent>
          <Typography variant="h6" component="h3" id="help-terms-heading">
            {t('help.terms')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('help.termsP')}
          </Typography>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="help-about-heading">
        <CardContent>
          <Typography variant="h6" component="h3" id="help-about-heading">
            {t('help.about')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('help.aboutP')}
          </Typography>
          <Link
            href="https://github.com/rajuofficialasf-hub/openpixel"
            target="_blank"
            rel="noreferrer"
            sx={{ display: 'inline-block', mt: 1 }}
          >
            github.com/rajuofficialasf-hub/openpixel
          </Link>
        </CardContent>
      </Card>
    </Stack>
  )
}
