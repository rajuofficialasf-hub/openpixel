/**
 * Category icon tile — one 40px tinted tile, one icon set, one
 * size. Shared by the tool cards and the homepage category cards
 * so the two grids read as one system.
 */
import { Box } from '@mui/material'
import ImageIcon from '@mui/icons-material/Image'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import DescriptionIcon from '@mui/icons-material/Description'
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import CompressIcon from '@mui/icons-material/Compress'
import MovieIcon from '@mui/icons-material/Movie'
import type { ToolCategory } from '../lib/routes'

const CATEGORY_ICONS: Record<ToolCategory, React.ReactNode> = {
  image: <ImageIcon />,
  pdf: <PictureAsPdfIcon />,
  document: <DescriptionIcon />,
  ocr: <DocumentScannerIcon />,
  conversion: <AutorenewIcon />,
  compression: <CompressIcon />,
  media: <MovieIcon />,
}

export function CategoryIcon({ category }: { category: ToolCategory }) {
  return (
    <Box
      sx={{
        width: 40,
        height: 40,
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: (t) => `${t.palette.primary.main}14`,
        color: 'primary.main',
        flex: 'none',
      }}
    >
      {CATEGORY_ICONS[category]}
    </Box>
  )
}
