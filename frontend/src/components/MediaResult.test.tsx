import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { MediaResult } from './MediaResult'
import type { MediaInfo } from '../types'

const media: MediaInfo = {
  id: 'test', title: 'A video worth keeping', platform: 'YouTube', uploader: 'A creator',
  thumbnail: null, duration: 125, audio_available: true,
  formats: [
    { id: '1080', label: '1080p', extension: 'mp4', height: 1080, filesize: null, has_audio: false },
    { id: '720', label: '720p', extension: 'mp4', height: 720, filesize: null, has_audio: true },
  ],
}

it('sends the selected source format and supports audio-only requests', async () => {
  const user = userEvent.setup()
  const onDownload = vi.fn()
  render(<MediaResult media={media} busy={false} onDownload={onDownload} />)
  await user.selectOptions(screen.getByLabelText('Video quality'), '720')
  await user.click(screen.getByRole('button', { name: 'Prepare video on device' }))
  expect(onDownload).toHaveBeenLastCalledWith(expect.objectContaining({ format_id: '720', mode: 'video' }))
  await user.click(screen.getByRole('button', { name: 'Audio only' }))
  await user.click(screen.getByRole('button', { name: 'Prepare MP3 on device' }))
  expect(onDownload).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'audio', audio_format: 'mp3', format_id: undefined }))
})

it('disables unavailable audio instead of offering a non-working format', () => {
  render(<MediaResult media={{ ...media, audio_available: false }} busy={false} onDownload={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Audio only' })).toBeDisabled()
})

it('shows quality without promising the video source container is the output container', () => {
  render(<MediaResult media={{ ...media, duration: null }} busy={false} onDownload={vi.fn()} />)
  expect(screen.getByRole('option', { name: '1080p' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /MP4/ })).not.toBeInTheDocument()
  expect(screen.getByText('Length unavailable')).toBeInTheDocument()
})
