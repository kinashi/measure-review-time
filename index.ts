import 'dotenv/config'
import { Octokit } from 'octokit'
import type { Endpoints } from '@octokit/types'
import dayjs from 'dayjs'
import ja from 'dayjs/locale/ja'
import { quantileSeq, round } from 'mathjs'

type Result = {
  title: string
  labels: string[]
  createdDate: string
  reviewRequestedDate: string
  firstCommentedAt: Date
  firstCommentLeadTime: number
  approvedDateTime: string
  approvedLeadTime: number
}

const getLeadTimeMinutes = (from: number, to: number) =>
  round((to - from) / 1000 / 60)

const minToTimeString = (min: number) =>
  min > 60
    ? min / 60 > 24
      ? `${(min / 60 / 24).toFixed(1)}日`
      : `${(min / 60).toFixed(1)}時間`
    : `${round(min)}分`

const main = async () => {
  const octokit = new Octokit({ auth: process.env.PERSONAL_ACCESS_TOKEN })
  let pulls: Endpoints['GET /search/issues']['response']['data']['items'] = []
  for await (const { data } of octokit.paginate.iterator(
    octokit.rest.search.issuesAndPullRequests,
    {
      q: `repo:${process.env.OWNER}/${process.env.REPO} created:${process.env.RANGE_OF_DATE} is:pr is:merged review:approved`,
      sort: 'created',
      order: 'asc',
      per_page: 50,
    },
  )) {
    pulls = [...pulls, ...(data ?? [])]
  }

  let results: Result[] = []
  for (const pull of pulls) {
    const user = pull.user?.login
    const [{ data: comments }, { data: reviews }, { data: events }] =
      await Promise.all([
        octokit.rest.pulls.listReviewComments({
          owner: process.env.OWNER,
          repo: process.env.REPO,
          pull_number: pull.number,
        }),
        octokit.rest.pulls.listReviews({
          owner: process.env.OWNER,
          repo: process.env.REPO,
          pull_number: pull.number,
        }),
        octokit.rest.issues.listEvents({
          owner: process.env.OWNER,
          repo: process.env.REPO,
          issue_number: pull.number,
        }),
      ])
    const labels = pull.labels
      .map((label) => label.name)
      .filter((label): label is Exclude<typeof label, undefined> => !!label)

    const reviewRequestedAt = events.find(
      (event) => event.event === 'review_requested',
    )?.created_at
    const firstCommentedAt = [
      ...comments
        .filter((comment) => comment.user?.login !== user)
        .map((comment) => new Date(comment.created_at ?? '')),
      ...reviews
        .filter((review) => review.user?.login !== user)
        .map((review) => new Date(review.submitted_at ?? '')),
    ].sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
    // reviewRequestedAt が firstCommentedAt より前の場合は reviewRequestedAt を使用
    const reviewStartedAt =
      reviewRequestedAt &&
      new Date(reviewRequestedAt).getTime() <
        new Date(firstCommentedAt).getTime()
        ? reviewRequestedAt
        : pull.created_at
    const approvedAt = reviews.find((review) => review.state === 'APPROVED')
      ?.submitted_at

    const createdDate = dayjs(pull.created_at).locale(ja).format('YY/MM/DD(dd)')
    const reviewRequestedDate = reviewRequestedAt
      ? dayjs(reviewRequestedAt).locale(ja).format('YY/MM/DD(dd) HH:mm')
      : ''
    const approvedDateTime = approvedAt
      ? dayjs(approvedAt).locale(ja).format('YY/MM/DD(dd) HH:mm')
      : ''

    const firstCommentLeadTime = getLeadTimeMinutes(
      new Date(reviewStartedAt).getTime(),
      new Date(firstCommentedAt).getTime(),
    )
    const approvedLeadTime = approvedAt
      ? getLeadTimeMinutes(
          new Date(reviewStartedAt).getTime(),
          new Date(approvedAt).getTime(),
        )
      : NaN

    // 最初のコメントまで2日以上かかったものを出力
    if (firstCommentLeadTime > 60 * 24 * 2) {
      console.log(pull.title, user, minToTimeString(approvedLeadTime))
    }

    results = [
      ...results,
      {
        title: pull.title,
        labels,
        createdDate,
        reviewRequestedDate,
        firstCommentedAt,
        firstCommentLeadTime,
        approvedDateTime,
        approvedLeadTime,
      },
    ]
  }

  results = results.filter((result) => {
    // title が Release で始まる PR は除外
    if (result.title.toLowerCase().startsWith('release')) return false
    // ラベルが 案件 の PR は除外
    if (result.labels.includes('案件')) return false

    return result.approvedDateTime
  })

  const firstCommentLeadTimes = results.map(
    (result) => result.firstCommentLeadTime,
  )
  const approvedLeadTimes = results.map((result) => result.approvedLeadTime)
  console.log(
    `\n${process.env.REPO}: ${process.env.RANGE_OF_DATE.replace('..', '~')} (${
      results.length
    }件)`,
  )
  if (firstCommentLeadTimes.length) {
    console.log(
      '最初のコメントまでの時間\n',
      `  50パーセンタイル: ${minToTimeString(
        quantileSeq(firstCommentLeadTimes, 0.5) as number,
      )}\n`,
      `  90パーセンタイル: ${minToTimeString(
        quantileSeq(firstCommentLeadTimes, 0.9) as number,
      )}`,
    )
  }
  if (approvedLeadTimes.length) {
    console.log(
      'Approve までの時間\n',
      `  50パーセンタイル: ${minToTimeString(
        quantileSeq(approvedLeadTimes, 0.5) as number,
      )}\n`,
      `  90パーセンタイル: ${minToTimeString(
        quantileSeq(approvedLeadTimes, 0.9) as number,
      )}`,
    )
  }
  if (!firstCommentLeadTimes.length && !approvedLeadTimes.length) {
    console.log('結果が取得できませんでした')
  }
}

main().catch(console.error)
