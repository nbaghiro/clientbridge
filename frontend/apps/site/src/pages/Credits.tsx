import { creditsPage } from "../content/solutions";
import { PHOTOS, type PhotoName } from "../content/photos";
import { strings } from "../strings";

export function Credits() {
    return (
        <section className="band">
            <div className="wrap narrow">
                <h1 className="h1">{creditsPage.title}</h1>
                <p className="lede mt-4">
                    {creditsPage.lede} <a href={creditsPage.licenseUrl}>{creditsPage.license}</a>
                </p>
                <table className="tbl credits mt-10">
                    <thead>
                        <tr>
                            <th>{creditsPage.columns.subject}</th>
                            <th>{creditsPage.columns.photographer}</th>
                            <th>{creditsPage.columns.source}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(Object.keys(PHOTOS) as PhotoName[]).map((name) => (
                            <tr key={name}>
                                <td>{strings.photos[name].subject}</td>
                                <td>{PHOTOS[name].photographer}</td>
                                <td>
                                    <a href={PHOTOS[name].source}>{creditsPage.view}</a>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
