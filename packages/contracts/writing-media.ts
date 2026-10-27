export const WRITING_IMAGE_LIMIT = 25 * 1024 * 1024;
export const WRITING_VIDEO_LIMIT = 100 * 1024 * 1024;
export const WRITING_MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov';
const images = new Set(['image/png','image/jpeg','image/webp','image/gif']);
const videos = new Set(['video/mp4','video/webm','video/quicktime']);
export const isWritingVideo = (mime:string) => videos.has(mime);
export const isWritingMedia = (mime:string) => images.has(mime) || videos.has(mime);
export function writingMediaMime(name:string,mime:string){
  if(mime && mime !== 'application/octet-stream') return mime;
  const extension=name.split('.').pop()?.toLowerCase()||'';
  return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'} as Record<string,string>)[extension] || mime;
}
export function writingMediaError(file:{name:string;type:string;size:number}){
  const mime=writingMediaMime(file.name,file.type);
  if(!isWritingMedia(mime)) return '正文只支持 PNG、JPG、WebP、GIF 和 MP4、WebM、MOV 视频';
  const limit=isWritingVideo(mime)?WRITING_VIDEO_LIMIT:WRITING_IMAGE_LIMIT;
  if(!file.size) return '文件为空，请重新选择';
  if(file.size>limit) return isWritingVideo(mime)?'视频超过 100 MB，请先压缩':'图片或 GIF 超过 25 MB，请先压缩';
  return '';
}
