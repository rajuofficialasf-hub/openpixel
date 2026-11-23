/**
 * Category & tool icon tiles — one 40px tinted tile, one icon set,
 * one size. Distinct per-tool icons make scanning tool grids much
 * faster than repeating the same generic category icon on every card.
 */
import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import ImageIcon from '@mui/icons-material/Image'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import DescriptionIcon from '@mui/icons-material/Description'
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import CompressIcon from '@mui/icons-material/Compress'
import MovieIcon from '@mui/icons-material/Movie'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import PhotoSizeSelectLargeIcon from '@mui/icons-material/PhotoSizeSelectLarge'
import LayersIcon from '@mui/icons-material/Layers'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import CropIcon from '@mui/icons-material/Crop'
import RotateRightIcon from '@mui/icons-material/RotateRight'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import CallMergeIcon from '@mui/icons-material/CallMerge'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import Rotate90DegreesCwIcon from '@mui/icons-material/Rotate90DegreesCw'
import OutputIcon from '@mui/icons-material/Output'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SwapVertIcon from '@mui/icons-material/SwapVert'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import GridViewIcon from '@mui/icons-material/GridView'
import EditNoteIcon from '@mui/icons-material/EditNote'
import HideSourceIcon from '@mui/icons-material/HideSource'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import LayersClearIcon from '@mui/icons-material/LayersClear'
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined'
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined'
import TextSnippetOutlinedIcon from '@mui/icons-material/TextSnippetOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import BrandingWatermarkOutlinedIcon from '@mui/icons-material/BrandingWatermarkOutlined'
import DrawOutlinedIcon from '@mui/icons-material/DrawOutlined'
import type { ToolCategory } from '../lib/routes'

const CATEGORY_ICONS: Record<ToolCategory, ReactNode> = {
  image: <ImageIcon />,
  pdf: <PictureAsPdfIcon />,
  document: <DescriptionIcon />,
  ocr: <DocumentScannerIcon />,
  conversion: <AutorenewIcon />,
  compression: <CompressIcon />,
  media: <MovieIcon />,
}

const TOOL_ICONS: Record<string, ReactNode> = {
  convert: <SwapHorizIcon />,
  resize: <PhotoSizeSelectLargeIcon />,
  'compress-image': <CompressIcon />,
  batch: <LayersIcon />,
  metadata: <InfoOutlinedIcon />,
  crop: <CropIcon />,
  rotate: <RotateRightIcon />,
  'bg-remove': <AutoFixHighIcon />,
  'pdf-merge': <CallMergeIcon />,
  'pdf-split': <CallSplitIcon />,
  'pdf-rotate': <Rotate90DegreesCwIcon />,
  'pdf-extract': <OutputIcon />,
  'pdf-remove': <DeleteOutlineIcon />,
  'pdf-reorder': <SwapVertIcon />,
  'pdf-duplicate': <ContentCopyIcon />,
  'pdf-reverse': <SwapVertIcon />,
  'pdf-booklet': <MenuBookIcon />,
  'pdf-nup': <GridViewIcon />,
  'pdf-compress': <CompressIcon />,
  'pdf-edit': <EditNoteIcon />,
  'pdf-redact': <HideSourceIcon />,
  'pdf-metadata': <InfoOutlinedIcon />,
  'pdf-sanitize': <CleaningServicesIcon />,
  'pdf-flatten': <LayersClearIcon />,
  'pdf-repair': <BuildOutlinedIcon />,
  'pdf-to-image': <PhotoLibraryOutlinedIcon />,
  'image-to-pdf': <PictureAsPdfIcon />,
  'pdf-text': <TextSnippetOutlinedIcon />,
  'pdf-ocr': <DocumentScannerIcon />,
  'pdf-protect': <LockOutlinedIcon />,
  'pdf-unlock': <LockOpenIcon />,
  'pdf-watermark': <BrandingWatermarkOutlinedIcon />,
  'pdf-sign': <DrawOutlinedIcon />,
  ocr: <DocumentScannerIcon />,
  'ocr-bengali': <DocumentScannerIcon />,
}

function IconTile({ children }: { children: ReactNode }) {
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
        '& .MuiSvgIcon-root': { fontSize: 20 },
      }}
    >
      {children}
    </Box>
  )
}

export function CategoryIcon({ category }: { category: ToolCategory }) {
  return <IconTile>{CATEGORY_ICONS[category]}</IconTile>
}

export function ToolIcon({ toolId, category }: { toolId: string; category: ToolCategory }) {
  return <IconTile>{TOOL_ICONS[toolId] ?? CATEGORY_ICONS[category]}</IconTile>
}
